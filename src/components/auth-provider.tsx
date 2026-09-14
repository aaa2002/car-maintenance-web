'use client';

import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

type AuthValue = { session: Session | null; user: User | null; loading: boolean; passwordRecovery: boolean; signIn: (email: string, password: string) => Promise<void>; signUp: (email: string, password: string, name?: string) => Promise<boolean>; signOut: () => Promise<void>; resetPassword: (email: string) => Promise<void>; updatePassword: (password: string) => Promise<void>; dismissPasswordRecovery: () => void };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setLoading(false); } });
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setLoading(false); if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true); });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    session, user: session?.user ?? null, loading, passwordRecovery,
    async signIn(email, password) { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; },
    async signUp(email, password, name) { const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: name?.trim() ? { display_name: name.trim() } : undefined, emailRedirectTo: location.origin } }); if (error) throw error; return !data.session; },
    async signOut() { const { error } = await supabase.auth.signOut(); if (error) throw error; setPasswordRecovery(false); },
    async resetPassword(email) { const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin }); if (error) throw error; },
    async updatePassword(password) { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setPasswordRecovery(false); history.replaceState(null, '', location.pathname); },
    dismissPasswordRecovery() { setPasswordRecovery(false); history.replaceState(null, '', location.pathname); },
  }), [session, loading, passwordRecovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
