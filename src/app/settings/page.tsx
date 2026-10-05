'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, ErrorAlert, PageHeader, SectionHeader, StatusPill, useToast } from '@/components/ui';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t, theme, setTheme, language, setLanguage, currency, setCurrency } = useSettings();
  const { toast } = useToast();
  const [error, setError] = useState<unknown>();
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

      <section>
        <SectionHeader title={t('webReminders')} />
        <div className="app-panel settings-reminder">
          <span className="row-icon tone-success"><i className="bi bi-bell" /></span>
          <div className="flex-grow-1"><div className="d-flex flex-wrap align-items-center gap-2 mb-1"><strong>{t('attentionFeedEnabled')}</strong><StatusPill tone="success">{t('active')}</StatusPill></div><p className="text-body-secondary small mb-0">{t('browserReminderNote')}</p></div>
        </div>
      </section>
    </div>
  </AppShell>;
}

function PreferenceRow({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="settings-row"><div className="d-flex align-items-center gap-3 min-w-0"><span className="row-icon"><i className={`bi ${icon}`} /></span><div className="min-w-0"><strong className="d-block">{title}</strong><span className="d-block text-body-secondary small mt-1 truncate">{subtitle}</span></div></div>{children}</div>;
}

function ChoiceGroup<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: { value: T; label: string; icon?: string }[]; onChange: (value: T) => void }) {
  return <div className="segmented settings-choice" role="group" aria-label={label}>{choices.map((choice) => <button type="button" key={choice.value} className={choice.value === value ? 'active' : ''} aria-pressed={choice.value === value} onClick={() => choice.value !== value && onChange(choice.value)}>{choice.icon && <i className={`bi ${choice.icon} me-2`} />}{choice.label}</button>)}</div>;
}
