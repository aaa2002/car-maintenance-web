// Creates (or finds) the Vehix products, prices, portal configuration and webhook in Stripe.
// Safe to re-run: everything is looked up by lookup_key / metadata / URL first.
//
// Usage: put STRIPE_SECRET_KEY=sk_test_... in .env.local, then run `node scripts/stripe-setup.mjs`.
// It never prints secrets. A newly created webhook signing secret is appended to .env.local
// as STRIPE_WEBHOOK_SECRET. The script prints the price IDs to store in public.plans.
import fs from 'node:fs';

const ENV_FILE = '.env.local';
const WEBHOOK_URL = 'https://apndecgnsclmuhqisjxd.supabase.co/functions/v1/stripe-webhook';
const API_VERSION = '2026-09-30.endive';
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'subscription_schedule.updated', 'subscription_schedule.released', 'subscription_schedule.canceled', 'subscription_schedule.completed',
];

const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n')
  .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const key = env.STRIPE_SECRET_KEY;
if (!key) throw new Error(`STRIPE_SECRET_KEY is missing from ${ENV_FILE}`);
if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) throw new Error('Refusing to run: this script is for a sandbox (sk_test_) key.');

// Stripe's form encoding: nested objects/arrays become a[b][0]=c.
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object') encode(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}
async function api(method, path, params) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  if (method === 'GET' && params) url.search = encode(params).toString();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': API_VERSION, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : encode(params ?? {}),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

const PLANS = [
  { id: 'standard', name: 'Vehix Standard', description: 'Up to 10 vehicles', price: { unit_amount: 4900 } },
  { id: 'pro', name: 'Vehix PRO', description: 'Up to 30 vehicles', price: { unit_amount: 9900 } },
  {
    id: 'fleet',
    name: 'Vehix FLEET',
    description: '60 vehicles included, 2 RON per additional vehicle',
    // One graduated price: the flat fee covers the first 60 cars, then 2 RON each. Quantity = car count.
    price: { billing_scheme: 'tiered', tiers_mode: 'graduated', tiers: [{ up_to: 60, flat_amount: 14900, unit_amount: 0 }, { up_to: 'inf', unit_amount: 200 }] },
  },
];

const priceIds = {};
for (const plan of PLANS) {
  const lookupKey = `vehix_${plan.id}_monthly_ron`;
  const existing = await api('GET', 'prices', { lookup_keys: [lookupKey], expand: ['data.product'] });
  if (existing.data[0]) {
    priceIds[plan.id] = existing.data[0].id;
    console.log(`found   ${plan.id}: ${existing.data[0].id}`);
    continue;
  }
  const product = await api('POST', 'products', { name: plan.name, description: plan.description, metadata: { app: 'vehix', plan: plan.id } });
  const price = await api('POST', 'prices', {
    product: product.id,
    currency: 'ron',
    recurring: { interval: 'month' },
    tax_behavior: 'inclusive', // prices are final, VAT included
    lookup_key: lookupKey,
    metadata: { app: 'vehix', plan: plan.id },
    ...plan.price,
  });
  priceIds[plan.id] = price.id;
  console.log(`created ${plan.id}: ${price.id}`);
}

// Customer portal: payment method, invoices, cancel at period end. Plan switching happens in the app.
const configs = await api('GET', 'billing_portal/configurations', { active: true, limit: 100 });
if (configs.data.some((c) => c.metadata?.app === 'vehix')) {
  console.log('found   portal configuration');
} else {
  await api('POST', 'billing_portal/configurations', {
    name: 'Vehix',
    metadata: { app: 'vehix' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
  });
  console.log('created portal configuration');
}

// Webhook to the stripe-webhook Edge Function.
const hooks = await api('GET', 'webhook_endpoints', { limit: 100 });
const hook = hooks.data.find((h) => h.url === WEBHOOK_URL);
if (hook) {
  const missing = EVENTS.filter((event) => !hook.enabled_events.includes(event));
  if (missing.length) {
    await api('POST', `webhook_endpoints/${hook.id}`, { enabled_events: EVENTS });
    console.log(`updated webhook ${hook.id}: added ${missing.join(', ')}`);
  } else {
    console.log(`found   webhook ${hook.id} (its signing secret is only shown once; reveal it in the Stripe dashboard if needed)`);
  }
} else {
  const created = await api('POST', 'webhook_endpoints', { url: WEBHOOK_URL, enabled_events: EVENTS, api_version: API_VERSION, description: 'Vehix subscriptions' });
  fs.appendFileSync(ENV_FILE, `\nSTRIPE_WEBHOOK_SECRET=${created.secret}\n`);
  console.log(`created webhook ${created.id}; signing secret written to ${ENV_FILE} as STRIPE_WEBHOOK_SECRET`);
}

console.log('\nPrice IDs for public.plans:');
console.log(JSON.stringify(priceIds, null, 2));
