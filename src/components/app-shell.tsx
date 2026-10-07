'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '@/lib/format';
import { AuthScreen } from './auth-screen';
import { BrandMark, BrandWordmark } from './brand-logo';
import { useAuth, useSettings } from './providers';
import { Loading, Modal } from './ui';

const nav = [
  { href: '/', key: 'garage' as const, icon: 'bi-car-front' },
  { href: '/drivers', key: 'drivers' as const, icon: 'bi-people' },
  { href: '/fines', key: 'fines' as const, icon: 'bi-receipt' },
  { href: '/spend', key: 'spend' as const, icon: 'bi-bar-chart' },
  { href: '/settings', key: 'settings' as const, icon: 'bi-gear' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, passwordRecovery } = useAuth();
  const { t } = useSettings();
  const pathname = usePathname();
  if (loading) return <main className="min-vh-100 d-flex align-items-center justify-content-center"><Loading /></main>;
  if (!user) return <AuthScreen />;

  const active = (href: string) => href === '/' ? pathname === '/' || pathname.startsWith('/vehicles/') : pathname.startsWith(href);
  return (
    <div className="app-shell">
      <a href="#main-content" className="visually-hidden-focusable position-fixed top-0 start-0 m-2 btn btn-primary" style={{ zIndex: 2100 }}>Skip to content</a>
      <aside className="desktop-sidebar">
        <Link href="/" className="brand-mark" aria-label="Vehix home">
          <BrandMark className="brand-mark-svg" />
          <BrandWordmark className="brand-word" />
        </Link>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} title={t(item.key)} className={`sidebar-link ${active(item.href) ? 'active' : ''}`}>
              <i className={`bi ${item.icon}`} aria-hidden="true" /><span>{t(item.key)}</span>
            </Link>
          ))}
        </nav>
        <Link href="/settings" className="sidebar-account text-decoration-none text-body" title={user.email ?? undefined}>
          <i className="bi bi-person-circle" />
          <span className="sidebar-account-copy"><span className="d-block small fw-semibold truncate">{user.user_metadata.display_name || 'Account'}</span><span className="d-block small text-body-secondary truncate">{user.email}</span></span>
        </Link>
      </aside>
      <div className="desktop-main"><main id="main-content" className="content-wrap">{children}</main></div>
      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className={`mobile-nav-link ${active(item.href) ? 'active' : ''}`}>
            <i className={`bi ${item.icon}`} aria-hidden="true" />{t(item.key)}
          </Link>
        ))}
      </nav>
      <PasswordRecoveryModal show={passwordRecovery} />
    </div>
  );
}

function PasswordRecoveryModal({ show }: { show: boolean }) {
  const { updatePassword, dismissPasswordRecovery } = useAuth(); const { t } = useSettings(); const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); if (password.length < 6) return setError(t('passwordLength')); if (password !== confirmPassword) return setError(t('passwordsMismatch')); setBusy(true); try { await updatePassword(password); setPassword(''); setConfirmPassword(''); } catch (caught) { setError(errorMessage(caught, t)); } finally { setBusy(false); } }
  return <Modal title={t('resetPassword')} show={show} onClose={dismissPasswordRecovery}><form onSubmit={submit}><div className="modal-body"><p className="text-body-secondary">{t('choosePassword')}</p><label className="form-label required" htmlFor="new-password">{t('password')}</label><input id="new-password" autoFocus type="password" minLength={6} className="form-control mb-3" value={password} onChange={(e) => setPassword(e.target.value)} required /><label className="form-label required" htmlFor="confirm-password">{t('confirmPassword')}</label><input id="confirm-password" type="password" minLength={6} className="form-control" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />{error && <div className="app-alert mt-3 mb-0">{error}</div>}</div><div className="modal-footer"><button className="btn btn-primary" disabled={busy}>{busy ? t('saving') : t('save')}</button></div></form></Modal>;
}
