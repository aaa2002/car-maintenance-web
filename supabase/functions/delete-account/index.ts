// Permanently deletes the signed-in user's account: their files, their Stripe customer (which cancels
// any subscription) and finally the auth user, which cascades to every public table that references it.
import { admin, handler, HttpError, json, requireUser, stripe } from '../_shared/billing.ts';

// Every upload lives under <user id>/<folder>/ (see src/lib/storage.ts).
const BUCKETS: Record<string, string[]> = { 'car-photos': ['cars'], 'car-documents': ['documents'] };
const PAGE = 1000;

/** Auth refuses to delete a user who still owns storage objects, so remove them first. */
async function removeFiles(userId: string) {
  for (const [bucket, folders] of Object.entries(BUCKETS)) {
    for (const folder of folders) {
      const prefix = `${userId}/${folder}`;
      for (;;) {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE });
        if (error) throw error;
        const paths = (data ?? []).filter((entry) => entry.id).map((entry) => `${prefix}/${entry.name}`);
        if (!paths.length) break;
        const { error: removeError } = await admin.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
        if (paths.length < PAGE) break;
      }
    }
  }
}

/** Deleting the customer cancels its subscriptions immediately; invoices stay in Stripe for accounting. */
async function removeStripeCustomer(userId: string) {
  const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (!data) return;
  if (!Deno.env.get('STRIPE_SECRET_KEY')) throw new HttpError(503, 'billing_not_configured');
  try { await stripe().customers.del(data.stripe_customer_id); }
  catch (error) { if ((error as { code?: string }).code !== 'resource_missing') throw error; }
}

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { confirm } = await req.json().catch(() => ({}));
  // The client asks the user to type their email; check it again here so a stray call cannot wipe an account.
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) throw new HttpError(400, 'confirmation_mismatch');

  await removeFiles(user.id);
  await removeStripeCustomer(user.id);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw error;
  return json({ deleted: true });
}));
