// Opens the Stripe customer portal (payment method, invoices, cancellation) for the signed-in user.
import { admin, appOrigin, handler, HttpError, json, requireUser, stripe } from '../_shared/billing.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { locale } = await req.json().catch(() => ({}));
  const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (!data) throw new HttpError(409, 'no_customer');
  // The setup script creates a portal configuration tagged app=vehix.
  const configs = await stripe().billingPortal.configurations.list({ active: true, limit: 20 });
  const configuration = configs.data.find((value) => value.metadata?.app === 'vehix')?.id;
  const session = await stripe().billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${appOrigin(req)}/settings`,
    locale: locale === 'ro' ? 'ro' : 'en',
    ...(configuration ? { configuration } : {}),
  });
  return json({ url: session.url });
}));
