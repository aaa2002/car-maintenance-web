'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { PlanSection } from '@/components/plan-section';
import { useAuth, useSettings } from '@/components/providers';
import { deleteAccount } from '@/lib/account';
import { errorMessage } from '@/lib/format';
import { ConfirmButton, ErrorAlert, Modal, PageHeader, SectionHeader, StatusPill, useToast } from '@/components/ui';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t, theme, setTheme, language, setLanguage, currency, setCurrency } = useSettings();
  const { toast } = useToast();
  const [error, setError] = useState<unknown>();
  const [deleting, setDeleting] = useState(false);
  const saved = () => toast(t('saved'));

  return <AppShell>
    <div className="settings-content">
      <PageHeader title={t('settings')} subtitle={t('localSettings')} />
      {Boolean(error) && <ErrorAlert error={error} />}

      <section className="mb-4">
        <SectionHeader title={t('account')} />
        <div className="app-panel settings-account">
          <div className="settings-account-avatar"><i className="bi bi-person" /></div>
          <div className="min-w-0 flex-grow-1">
            <strong className="d-block">{user?.user_metadata.display_name || t('account')}</strong>
            <span className="d-block text-body-secondary text-break mt-1">{user?.email}</span>
          </div>
          <ConfirmButton title={t('signOut')} message={`${t('signOut')}?`} confirmLabel={t('signOut')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { try { await signOut(); router.replace('/'); } catch (caught) { setError(caught); } }}><i className="bi bi-box-arrow-right me-2" />{t('signOut')}</ConfirmButton>
        </div>
      </section>

      <Suspense fallback={null}><PlanSection /></Suspense>

      <section className="mb-4">
        <SectionHeader title={t('preferences')} />
        <div className="app-panel">
          <PreferenceRow icon="bi-circle-half" title={t('appearance')} subtitle={theme === 'system' ? t('followDevice') : t(theme)}>
            <ChoiceGroup label={t('appearance')} value={theme} choices={[{ value: 'system', label: t('system'), icon: 'bi-circle-half' }, { value: 'light', label: t('light'), icon: 'bi-sun' }, { value: 'dark', label: t('dark'), icon: 'bi-moon' }]} onChange={(value) => { setTheme(value); saved(); }} />
          </PreferenceRow>
          <PreferenceRow icon="bi-translate" title={t('language')} subtitle={language === 'en' ? 'English (UK)' : 'Română (RO)'}>
            <ChoiceGroup label={t('language')} value={language} choices={[{ value: 'en', label: 'English' }, { value: 'ro', label: 'Română' }]} onChange={(value) => { setLanguage(value); saved(); }} />
          </PreferenceRow>
          <PreferenceRow icon="bi-cash-coin" title={t('currency')} subtitle={currency === 'RON' ? 'Romanian leu' : 'Euro'}>
            <ChoiceGroup label={t('currency')} value={currency} choices={[{ value: 'RON', label: 'RON' }, { value: 'EUR', label: 'EUR' }]} onChange={(value) => { setCurrency(value); saved(); }} />
          </PreferenceRow>
        </div>
      </section>

      <section className="mb-4">
        <SectionHeader title={t('legal')} />
        <div className="app-panel">
          <PreferenceRow icon="bi-shield-lock" title={t('privacyPolicy')} subtitle={t('privacySubtitle')}>
            <Link href="/privacy" className="btn btn-outline-secondary btn-sm"><i className="bi bi-box-arrow-up-right me-2" />{t('privacyPolicy')}</Link>
          </PreferenceRow>
        </div>
      </section>

      <section className="mb-4">
        <SectionHeader title={t('webReminders')} />
        <div className="app-panel settings-reminder">
          <span className="row-icon tone-success"><i className="bi bi-bell" /></span>
          <div className="flex-grow-1"><div className="d-flex flex-wrap align-items-center gap-2 mb-1"><strong>{t('attentionFeedEnabled')}</strong><StatusPill tone="success">{t('active')}</StatusPill></div><p className="text-body-secondary small mb-0">{t('browserReminderNote')}</p></div>
        </div>
      </section>

      <section>
        <SectionHeader title={t('dangerZone')} />
        <div className="app-panel">
          <PreferenceRow icon="bi-trash3" title={t('deleteAccount')} subtitle={t('deleteAccountSubtitle')}>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setDeleting(true)}>{t('deleteAccount')}</button>
          </PreferenceRow>
        </div>
      </section>
      <DeleteAccountModal show={deleting} email={user?.email ?? ''} onClose={() => setDeleting(false)} onDeleted={() => { toast(t('accountDeleted')); router.replace('/'); }} />
    </div>
  </AppShell>;
}

function PreferenceRow({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="settings-row"><div className="d-flex align-items-center gap-3 min-w-0"><span className="row-icon"><i className={`bi ${icon}`} /></span><div className="min-w-0"><strong className="d-block">{title}</strong><span className="d-block text-body-secondary small mt-1 truncate">{subtitle}</span></div></div>{children}</div>;
}

function ChoiceGroup<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: { value: T; label: string; icon?: string }[]; onChange: (value: T) => void }) {
  return <div className="segmented settings-choice" role="group" aria-label={label}>{choices.map((choice) => <button type="button" key={choice.value} className={choice.value === value ? 'active' : ''} aria-pressed={choice.value === value} onClick={() => choice.value !== value && onChange(choice.value)}>{choice.icon && <i className={`bi ${choice.icon} me-2`} />}{choice.label}</button>)}</div>;
}

/** Typing the account email is the confirmation; the server checks it again before deleting anything. */
function DeleteAccountModal({ show, email, onClose, onDeleted }: { show: boolean; email: string; onClose: () => void; onDeleted: () => void }) {
  const { t } = useSettings();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setBusy(true); setError(undefined);
    try { await deleteAccount(typed); onDeleted(); }
    catch (caught) { setError(caught); setBusy(false); }
  }
  return <Modal title={t('deleteAccount')} show={show} onClose={() => !busy && onClose()} variant="modal">
    <form onSubmit={submit}>
      <div className="modal-body">
        <p className="text-body-secondary">{t('deleteAccountWarning')}</p>
        <label className="form-label required" htmlFor="delete-account-email">{t('deleteAccountConfirm')}</label>
        <input id="delete-account-email" type="email" className="form-control" autoComplete="off" placeholder={email} value={typed} onChange={(event) => setTyped(event.target.value)} required />
        {Boolean(error) && <div className="app-alert mt-3 mb-0" role="alert">{errorMessage(error, t)}</div>}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button>
        <button type="submit" className="btn btn-danger" disabled={busy || !matches}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{busy ? t('deleting') : t('deleteAccount')}</button>
      </div>
    </form>
  </Modal>;
}
