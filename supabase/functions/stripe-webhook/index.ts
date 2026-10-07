// Receives Stripe events (signature-verified) and mirrors subscription state into the database.
import { admin, cryptoProvider, json, stripe, syncFleetQuantity, syncSubscription } from '../_shared/billing.ts';

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '', undefined, cryptoProvider);
  } catch (error) {
    return json({ error: `invalid_signature: ${(error as Error).message}` }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (session.client_reference_id && customer) {
          await admin.from('billing_customers').upsert({ user_id: session.client_reference_id, stripe_customer_id: customer }, { onConflict: 'user_id' });
        }
        if (typeof session.subscription === 'string') {
          const synced = await syncSubscription(await stripe().subscriptions.retrieve(session.subscription));
          if (synced?.plan === 'fleet') await syncFleetQuantity(synced.userId);
        }
        break;
      }
      case 'subscription_schedule.updated':
      case 'subscription_schedule.released':
      case 'subscription_schedule.canceled':
      case 'subscription_schedule.completed': {
        const subscriptionId = event.data.object.subscription ?? event.data.object.released_subscription;
        const id = typeof subscriptionId === 'string' ? subscriptionId : subscriptionId?.id;
        if (id) await syncSubscription(await stripe().subscriptions.retrieve(id));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const synced = await syncSubscription(event.data.object);
        if (synced?.plan === 'fleet') await syncFleetQuantity(synced.userId);
        break;
      }
    }
  } catch (error) {
    console.error('webhook handling failed', event.type, error);
    // Let Stripe retry.
    return json({ error: 'handling_failed' }, 500);
  }
  return json({ received: true });
});
