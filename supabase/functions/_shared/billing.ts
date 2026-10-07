// Shared helpers for the billing Edge Functions (Stripe sandbox or live, depending on the key).
import Stripe from 'npm:stripe@23.0.0';
import { createClient, type User } from 'npm:@supabase/supabase-js@2';

let client: Stripe | null = null;
/** Created on first use so functions still boot (and answer clearly) before the key is configured. */
export function stripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new HttpError(503, 'billing_not_configured');
  client ??= new Stripe(key, { apiVersion: '2026-09-30.endive', httpClient: Stripe.createFetchHttpClient() });
  return client;
}
export const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Prefer the legacy service_role JWT while it exists (works with every client); fall back to the new secret key.
function adminKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default as string;
}
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });

export type PlanId = 'free' | 'standard' | 'pro' | 'fleet';
export type Plan = { id: PlanId; vehicle_limit: number | null; included_vehicles: number; monthly_price_bani: number; stripe_price_id: string | null };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Handles CORS preflight; returns a Response for OPTIONS, otherwise null. */
export function preflight(req: Request) {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Wraps a handler with CORS and turns thrown HttpErrors into JSON responses. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const early = preflight(req);
    if (early) return early;
    try {
      return await fn(req);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: 'internal_error' }, 500);
    }
  };
}

export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'not_signed_in');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_signed_in');
  return data.user;
}

// Stripe redirects back to the app; only allow known origins (localhost, Vercel previews, configured domains).
export function appOrigin(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const extra = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const allowed = /^http:\/\/localhost(:\d+)?$/.test(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) || extra.includes(origin);
  if (!allowed) throw new HttpError(400, 'origin_not_allowed');
  return origin;
}

export async function loadPlans(): Promise<Plan[]> {
  const { data, error } = await admin.from('plans').select('id, vehicle_limit, included_vehicles, monthly_price_bani, stripe_price_id').order('sort_order');
  if (error) throw error;
  return data as Plan[];
}

export async function vehicleCount(userId: string) {
  const { count, error } = await admin.from('cars').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

/** FLEET is one graduated price billed per car (60 included in the flat fee); every other plan is quantity 1. */
export async function quantityFor(plan: PlanId, userId: string) {
  return plan === 'fleet' ? Math.max(1, await vehicleCount(userId)) : 1;
}

export async function stripeCustomerFor(user: User) {
  const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (data) return data.stripe_customer_id as string;
  const customer = await stripe().customers.create({ email: user.email, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
  const { error } = await admin.from('billing_customers').insert({ user_id: user.id, stripe_customer_id: customer.id });
  if (error && error.code !== '23505') throw error;
  return customer.id;
}

const ENDED = new Set(['canceled', 'incomplete_expired']);

/** Mirrors a Stripe subscription into public.subscriptions (or removes it once it has ended). */
export async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  let userId = subscription.metadata?.user_id;
  if (!userId) {
    const { data } = await admin.from('billing_customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    userId = data?.user_id;
  }
  if (!userId) { console.warn('No user for customer', customerId); return null; }

  if (ENDED.has(subscription.status)) {
    await admin.from('subscriptions').delete().eq('user_id', userId).eq('stripe_subscription_id', subscription.id);
    return { userId, plan: 'free' as PlanId };
  }
  const item = subscription.items.data[0];
  const plans = await loadPlans();
  const plan = plans.find((value) => value.stripe_price_id === item.price.id);
  if (!plan) { console.warn('Unknown price', item.price.id); return null; }
  const scheduledPrice = await scheduledPriceId(subscription, item.current_period_end);
  const scheduledPlan = scheduledPrice ? plans.find((value) => value.stripe_price_id === scheduledPrice)?.id ?? null : null;
  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    plan_id: plan.id,
    status: subscription.status,
    stripe_subscription_id: subscription.id,
    stripe_item_id: item.id,
    quantity: item.quantity ?? 1,
    current_period_end: new Date(item.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end || Boolean(subscription.cancel_at),
    scheduled_plan_id: scheduledPlan && scheduledPlan !== plan.id ? scheduledPlan : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
  return { userId, plan: plan.id };
}

const priceId = (price: string | Stripe.Price) => (typeof price === 'string' ? price : price.id);

/** The price a pending schedule switches to at renewal (a scheduled downgrade), if any. */
async function scheduledPriceId(subscription: Stripe.Subscription, periodEnd: number) {
  if (!subscription.schedule) return null;
  const id = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id;
  const schedule = await stripe().subscriptionSchedules.retrieve(id);
  if (schedule.status !== 'active' && schedule.status !== 'not_started') return null;
  const next = schedule.phases.find((phase) => phase.start_date >= periodEnd);
  return next ? priceId(next.items[0].price) : null;
}

/** Drops a pending scheduled change so the subscription can be updated directly again. */
export async function releaseSchedule(subscription: Stripe.Subscription) {
  if (!subscription.schedule) return;
  const id = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id;
  await stripe().subscriptionSchedules.release(id);
}

/**
 * Keeps a FLEET subscription's quantity equal to the user's car count. Extra cars are invoiced
 * immediately (so they cannot be added and dropped before the next invoice); removing cars mid-period
 * is not refunded and simply lowers the next renewal.
 */
export async function syncFleetQuantity(userId: string) {
  const { data: row } = await admin.from('subscriptions').select('plan_id, status, stripe_subscription_id, stripe_item_id, quantity').eq('user_id', userId).maybeSingle();
  if (!row || row.plan_id !== 'fleet' || !['active', 'trialing', 'past_due'].includes(row.status)) return { changed: false };
  const quantity = await quantityFor('fleet', userId);
  if (quantity === row.quantity) return { changed: false, quantity };
  const proration_behavior = quantity > row.quantity ? 'always_invoice' : 'none';
  const subscription = await stripe().subscriptions.retrieve(row.stripe_subscription_id);
  if (subscription.schedule) {
    // A downgrade is pending: change the current phase's quantity and keep the scheduled next phase.
    const id = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id;
    const schedule = await stripe().subscriptionSchedules.retrieve(id);
    const phases = schedule.phases.map((phase, index) => ({
      items: phase.items.map((item) => ({ price: priceId(item.price), quantity: index === 0 ? quantity : item.quantity })),
      start_date: phase.start_date,
      end_date: phase.end_date,
    }));
    await stripe().subscriptionSchedules.update(id, { phases, proration_behavior });
  } else {
    await stripe().subscriptionItems.update(row.stripe_item_id, { quantity, proration_behavior });
  }
  await admin.from('subscriptions').update({ quantity, updated_at: new Date().toISOString() }).eq('user_id', userId);
  return { changed: true, quantity };
}
