'use client';

import { useState, type FormEvent } from 'react';
import { useAuth, useSettings } from './providers';
import { ErrorAlert } from './ui';
import { AppError } from '@/lib/format';
import type { StringKey } from '@/i18n/strings';

export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
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
      if (mode === 'signin') await signIn(email, password);
      else if (await signUp(email, password, name)) setNotice('checkEmail');
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
        <div className="auth-copy">
          <span className="brand-mark text-white"><span className="brand-mark-icon"><i className="bi bi-car-front-fill" /></span><span>Vehix</span></span>
          <h1>{t('welcome')}</h1>
          <p className="fs-5 text-white-50">{t('authSubtitle')}</p>
          <div className="d-none d-md-flex gap-4 mt-4 small text-white-50">
            <span><i className="bi bi-check-circle me-2 text-warning" />{t('fleetHealth')}</span>
            <span><i className="bi bi-check-circle me-2 text-warning" />{t('costsAndTrips')}</span>
            <span><i className="bi bi-check-circle me-2 text-warning" />{t('itpAndRca')}</span>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <div className="d-flex justify-content-between align-items-start mb-4">
            <div><div className="eyebrow mb-2">{mode === 'signin' ? t('welcome') : t('signUp')}</div><h2 className="h3 fw-bold mb-0">{mode === 'signin' ? t('signIn') : t('signUp')}</h2></div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setLanguage(language === 'en' ? 'ro' : 'en')}>{language === 'en' ? 'RO' : 'EN'}</button>
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
