import { invoke } from './billing';
import { supabase } from './supabase';

/** Deletes the signed-in account and everything in it, then drops the local session (the user no longer exists server-side). */
export async function deleteAccount(confirm: string) {
  await invoke<{ deleted: boolean }>('delete-account', { confirm });
  await supabase.auth.signOut({ scope: 'local' });
}
