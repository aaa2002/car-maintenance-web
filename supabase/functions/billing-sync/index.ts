// Called by the cars trigger (pg_net) after a FLEET customer adds or removes a car.
// Authorised by a shared token kept in Vault; the work itself only re-derives state from the database.
import { admin, handler, HttpError, json, syncFleetQuantity } from '../_shared/billing.ts';

function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(handler(async (req) => {
  const { data: expected, error } = await admin.rpc('billing_sync_token');
  if (error || !expected || !sameToken(req.headers.get('x-billing-sync-token') ?? '', expected as string)) throw new HttpError(401, 'unauthorized');
  const { user_id: userId } = await req.json().catch(() => ({}));
  if (typeof userId !== 'string') throw new HttpError(400, 'missing_user');
  return json(await syncFleetQuantity(userId));
}));
