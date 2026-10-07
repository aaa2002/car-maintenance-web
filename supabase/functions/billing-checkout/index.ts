// Starts a Stripe Checkout for a paid plan. Users who already subscribe change plans via billing-change-plan.
import { admin, appOrigin, handler, HttpError, json, loadPlans, quantityFor, requireUser, stripe, stripeCustomerFor } from '../_shared/billing.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { plan: planId, locale } = await req.json().catch(() => ({}));
  const plan = (await loadPlans()).find((value) => value.id === planId);
  if (!plan || !plan.stripe_price_id) throw new HttpError(400, 'unknown_plan');

  const { data: existing } = await admin.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle();
  if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) throw new HttpError(409, 'already_subscribed');

  const origin = appOrigin(req);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: await stripeCustomerFor(user),
    client_reference_id: user.id,
    line_items: [{ price: plan.stripe_price_id, quantity: await quantityFor(plan.id, user.id) }],
    subscription_data: { metadata: { user_id: user.id } },
    metadata: { user_id: user.id },
    locale: locale === 'ro' ? 'ro' : 'en',
    success_url: `${origin}/settings?billing=success`,
    cancel_url: `${origin}/settings?billing=cancelled`,
  });
  return json({ url: session.url });
}));
