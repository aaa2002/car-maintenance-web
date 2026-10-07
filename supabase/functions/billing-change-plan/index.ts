// Switches an existing subscription between paid plans, or schedules / undoes cancellation.
// Upgrades apply immediately (invoiced now, applied once paid). Downgrades and cancellations take
// effect at the end of the paid period, with no credit, so a plan cannot be used briefly and dropped.
import { admin, handler, HttpError, json, loadPlans, quantityFor, releaseSchedule, requireUser, stripe, syncSubscription } from '../_shared/billing.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { action, plan: planId } = await req.json().catch(() => ({}));
  const { data: row } = await admin.from('subscriptions').select('plan_id, status, stripe_subscription_id, stripe_item_id').eq('user_id', user.id).maybeSingle();
  if (!row || !['active', 'trialing', 'past_due'].includes(row.status)) throw new HttpError(409, 'no_subscription');
  const subscription = await stripe().subscriptions.retrieve(row.stripe_subscription_id);

  if (action === 'cancel' || action === 'resume') {
    // Cancelling replaces a pending downgrade; keeping the plan clears both.
    await releaseSchedule(subscription);
    await syncSubscription(await stripe().subscriptions.update(subscription.id, { cancel_at_period_end: action === 'cancel' }));
    return json({ ok: true });
  }
  if (action !== 'change') throw new HttpError(400, 'unknown_action');

  const plans = await loadPlans();
  const next = plans.find((value) => value.id === planId);
  const current = plans.find((value) => value.id === row.plan_id);
  if (!next || !next.stripe_price_id || !current) throw new HttpError(400, 'unknown_plan');

  await releaseSchedule(subscription);
  if (subscription.cancel_at_period_end) await stripe().subscriptions.update(subscription.id, { cancel_at_period_end: false });
  if (next.id === current.id) {
    // Choosing the current plan again just undoes a pending downgrade or cancellation.
    await syncSubscription(await stripe().subscriptions.retrieve(subscription.id));
    return json({ ok: true, applied: true });
  }

  if (next.monthly_price_bani > current.monthly_price_bani) {
    const updated = await stripe().subscriptions.update(subscription.id, {
      items: [{ id: row.stripe_item_id, price: next.stripe_price_id, quantity: await quantityFor(next.id, user.id) }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });
    await syncSubscription(updated);
    const applied = updated.items.data[0].price.id === next.stripe_price_id;
    return json({ ok: true, applied, pending: !applied });
  }

  // Downgrade: keep the current plan until renewal, then switch price (no proration, no credit).
  const schedule = await stripe().subscriptionSchedules.create({ from_subscription: subscription.id });
  const currentPhase = schedule.phases[0];
  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        items: currentPhase.items.map((item) => ({ price: typeof item.price === 'string' ? item.price : item.price.id, quantity: item.quantity })),
        start_date: currentPhase.start_date,
        end_date: currentPhase.end_date,
      },
      { items: [{ price: next.stripe_price_id, quantity: await quantityFor(next.id, user.id) }], duration: { interval: 'month', interval_count: 1 } },
    ],
  });
  const synced = await stripe().subscriptions.retrieve(subscription.id);
  await syncSubscription(synced);
  return json({ ok: true, scheduled: true, effective: currentPhase.end_date });
}));
