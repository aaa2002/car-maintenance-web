'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth, useSettings } from './providers';
import { BrandMark, BrandWordmark } from './brand-logo';
import { ErrorAlert, StatusPill } from './ui';
import { AppError } from '@/lib/format';
import type { StringKey } from '@/i18n/strings';

type PreviewRow = { title: (t: (key: StringKey) => string) => string; vehicle: string; icon: string; tone: 'warning' | 'brand' | 'success'; label: StringKey };
const previewRows: PreviewRow[] = [
  { title: () => 'ITP', vehicle: 'Dacia Logan', icon: 'bi-clipboard2-check', tone: 'warning', label: 'expiresSoon' },
  { title: (t) => t('scheduledRepair'), vehicle: 'Volkswagen Golf', icon: 'bi-tools', tone: 'brand', label: 'scheduled' },
  { title: () => 'RCA', vehicle: 'Škoda Octavia', icon: 'bi-shield-check', tone: 'success', label: 'valid' },
];

export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const router = useRouter();
  const { t, language, setLanguage } = useSettings();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<StringKey | ''>('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined); setNotice('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(new AppError('invalidEmail'));
    if (password.length < 6) return setError(new AppError('passwordLength'));
    setBusy(true);
    try {
      // The sign-in screen renders in place of whatever page was open, so always land on the Garage.
      if (mode === 'signin') { await signIn(email, password); router.replace('/'); }
      else if (await signUp(email, password, name)) setNotice('checkEmail');
      else router.replace('/');
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  async function reset() {
    setError(undefined); setNotice('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(new AppError('invalidEmail'));
    setBusy(true);
    try { await resetPassword(email); setNotice('resetSent'); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-layout">
      <section className="auth-visual" aria-label="Vehix">
        <span className="brand-mark text-white"><BrandMark className="brand-mark-svg" /><BrandWordmark className="brand-word" aria-label="Vehix" /></span>
        <div className="auth-copy">
          <h1>{t('welcome')}</h1>
          <p>{t('authSubtitle')}</p>
        </div>
        {/* A real preview of the Garage attention list, rendered with the app's own components. */}
        <div className="auth-stack" aria-hidden="true">
          <div className="auth-stack-ghost" />
          <div className="auth-preview data-list">
          {previewRows.map((row) => (
            <div className="data-row" key={row.vehicle}>
              <span className={`row-icon tone-${row.tone}`}><i className={`bi ${row.icon}`} /></span>
              <span className="data-row-main"><span className="data-row-title">{row.title(t)}</span><span className="data-row-subtitle">{row.vehicle}</span></span>
              <StatusPill tone={row.tone}>{t(row.label)}</StatusPill>
            </div>
          ))}
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <div className="auth-form-head">
            <h2>{mode === 'signin' ? t('signIn') : t('signUp')}</h2>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setLanguage(language === 'en' ? 'ro' : 'en')} aria-label={language === 'en' ? 'Română' : 'English'}>{language === 'en' ? 'RO' : 'EN'}</button>
          </div>
          {Boolean(error) && <ErrorAlert error={error} />}
          {notice && <div className="app-alert tone-success mb-4" role="status"><i className="bi bi-envelope-check-fill" /><span>{t(notice)}</span></div>}
          <form onSubmit={submit} noValidate>
            {mode === 'signup' && <div className="mb-3"><label className="form-label" htmlFor="name">{t('displayName')}</label><input id="name" className="form-control" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></div>}
            <div className="mb-3"><label className="form-label required" htmlFor="email">{t('email')}</label><input id="email" type="email" autoComplete="email" className="form-control" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="mb-3">
              <label className="form-label required" htmlFor="password">{t('password')}</label>
              <div className="input-group"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} className="form-control" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="btn btn-outline-secondary" type="button" aria-label={showPassword ? t('hidePassword') : t('showPassword')} onClick={() => setShowPassword((value) => !value)}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} /></button></div>
              {mode === 'signup' && <div className="form-text">{t('passwordLength')}</div>}
            </div>
            <button className="btn btn-primary w-100" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{mode === 'signin' ? t('signIn') : t('signUp')}</button>
            {mode === 'signin' && <button type="button" className="btn btn-link btn-sm w-100 mt-2" disabled={busy} onClick={reset}>{t('forgotPassword')}</button>}
          </form>
          <div className="border-top mt-4 pt-4 text-center text-body-secondary">{mode === 'signin' ? t('needAccount') : t('haveAccount')} <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(undefined); setNotice(''); }}>{mode === 'signin' ? t('signUp') : t('signIn')}</button></div>
        </div>
      </section>
    </main>
  );
}
