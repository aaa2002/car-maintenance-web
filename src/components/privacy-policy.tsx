'use client';

import Link from 'next/link';
import { useAuth, useSettings } from './providers';
import { BrandMark, BrandWordmark } from './brand-logo';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_UPDATED, privacyPolicy } from '@/content/privacy';
import { localDate } from '@/lib/format';

/** Public: readable with or without an account, in the language chosen for the app. */
export function PrivacyPolicy() {
  const { t, language, setLanguage } = useSettings();
  const { user } = useAuth();
  const policy = privacyPolicy[language];

  return (
    <main className="legal-page">
      <header className="legal-head">
        <Link href="/" className="brand-mark text-decoration-none text-body" aria-label="Vehix home"><BrandMark className="brand-mark-svg" /><BrandWordmark className="brand-word" /></Link>
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setLanguage(language === 'en' ? 'ro' : 'en')} aria-label={language === 'en' ? 'Română' : 'English'}>{language === 'en' ? 'RO' : 'EN'}</button>
          <Link href="/" className="btn btn-sm btn-primary">{user ? t('backToApp') : t('signIn')}</Link>
        </div>
      </header>
      <article className="legal-body">
        <h1 className="page-title">{policy.title}</h1>
        <p className="page-subtitle">{policy.updated}: {localDate(PRIVACY_UPDATED, language)}</p>
        {policy.intro.map((text) => <p key={text}>{text}</p>)}
        {policy.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
            {section.bullets && <ul>{section.bullets.map((text) => <li key={text}>{text}</li>)}</ul>}
            {section.after?.map((text) => <p key={text}>{text}</p>)}
          </section>
        ))}
        <p><a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a></p>
      </article>
    </main>
  );
}
