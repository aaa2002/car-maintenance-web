import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
  );
}

export const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  action: string
): T {
  if (result.error) throw new Error(`${action} failed: ${result.error.message}`);
  if (result.data === null) throw new Error(`${action} failed: no data returned.`);
  return result.data;
}

export function unwrapList<T>(
  result: { data: T[] | null; error: { message: string } | null },
  action: string
): T[] {
  if (result.error) throw new Error(`${action} failed: ${result.error.message}`);
  return result.data ?? [];
}

export function expectOk(result: { error: { message: string } | null }, action: string) {
  if (result.error) throw new Error(`${action} failed: ${result.error.message}`);
}
