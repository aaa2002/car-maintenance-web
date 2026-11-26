'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getCompanyProfile, saveCompanyProfile, type CompanyProfile } from '@/lib/invoicing';
import { errorMessage } from '@/lib/format';
import { validCui, validIban } from '@/lib/romania';
import { CountyCityFields } from './driver-forms';
import { useAuth, useSettings } from './providers';
import { SectionHeader, SetupBanner, useToast } from './ui';

const EMPTY: CompanyProfile = {
  name: '', taxId: '', vatPayer: true, regNo: null, address: '', city: '', county: '', country: 'RO', iban: null, bank: null, email: null, phone: null,
  invoiceSeries: 'VHX', nextInvoiceNumber: 1, defaultVatRate: 21, paymentDays: 7, invoiceNote: null,
};

/** The fleet company that issues invoices: legal details, bank account, invoice series and VAT settings. */
export function CompanySection() {
  const { t } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try { const value = await getCompanyProfile(); setProfile(value ?? EMPTY); setExists(Boolean(value)); }
    catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setLoading(false); }
  }, [user, t]);
  useEffect(() => { void load(); }, [load]);
  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const next: Record<string, string> = {};
    if (profile.name.trim().length < 2) next.name = t('requiredFields');
    if (!validCui(profile.taxId.trim())) next.taxId = t('taxIdInvalid');
    if (!profile.address.trim()) next.address = t('requiredFields');
    if (!profile.county) next.county = t('requiredFields');
    if (!profile.city.trim()) next.city = t('requiredFields');
    if (profile.iban && !validIban(profile.iban)) next.iban = t('ibanInvalid');
    if (!/^[A-Za-z0-9-]{1,10}$/.test(profile.invoiceSeries.trim())) next.series = t('seriesInvalid');
    if (!Number.isInteger(profile.nextInvoiceNumber) || profile.nextInvoiceNumber < 1) next.number = t('invalidNumber');
    if (!Number.isFinite(profile.defaultVatRate) || profile.defaultVatRate < 0 || profile.defaultVatRate > 100) next.vat = t('percentInvalid');
    if (!Number.isInteger(profile.paymentDays) || profile.paymentDays < 0 || profile.paymentDays > 365) next.days = t('invalidNumber');
    setErrors(next); if (Object.keys(next).length) return;
    setBusy(true);
    try { await saveCompanyProfile(profile, exists); await load(); toast(t('saved')); }
    catch (caught) { setFormError(/duplicate key|invoices_user_id_series_number/.test(String(caught)) ? t('seriesNumberUsed') : errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  const field = (key: string) => (errors[key] ? 'is-invalid' : '');
  const feedback = (key: string) => (errors[key] ? <div className="invalid-feedback">{errors[key]}</div> : null);
  return <section className="mb-4" id="company">
    <SectionHeader title={t('companyDetails')} />
    <form className="app-panel app-panel-body" onSubmit={submit} noValidate>
      {!loading && !exists ? <SetupBanner icon="bi-receipt" title={t('companyNotSetUp')} text={t('companyNotSetUpText')} /> : <p className="small text-body-secondary">{t('companyDetailsHint')}</p>}
      {loading ? <div className="skeleton" style={{ height: 120 }} /> : <div className="row g-3">
        <div className="col-md-8"><label className="form-label required" htmlFor="company-name">{t('companyName')}</label><input id="company-name" className={`form-control ${field('name')}`} maxLength={200} value={profile.name} onChange={(event) => set('name', event.target.value)} />{feedback('name')}</div>
        <div className="col-md-4"><label className="form-label required" htmlFor="company-tax">{t('taxId')}</label><input id="company-tax" className={`form-control ${field('taxId')}`} maxLength={12} placeholder="RO12345678" value={profile.taxId} onChange={(event) => set('taxId', event.target.value)} />{feedback('taxId')}</div>
        <div className="col-md-4"><label className="form-label" htmlFor="company-reg">{t('regNo')}</label><input id="company-reg" className="form-control" maxLength={40} placeholder="J40/1234/2020" value={profile.regNo ?? ''} onChange={(event) => set('regNo', event.target.value)} /></div>
        <div className="col-md-8 d-flex align-items-end"><div className="form-check form-switch mb-2"><input id="company-vat" type="checkbox" role="switch" className="form-check-input" checked={profile.vatPayer} onChange={(event) => set('vatPayer', event.target.checked)} /><label className="form-check-label" htmlFor="company-vat">{t('vatPayer')}</label></div></div>
        <div className="col-12"><label className="form-label required" htmlFor="company-address">{t('streetAddress')}</label><input id="company-address" className={`form-control ${field('address')}`} maxLength={200} value={profile.address} onChange={(event) => set('address', event.target.value)} />{feedback('address')}</div>
        <CountyCityFields idPrefix="company" required county={profile.county} city={profile.city} onCounty={(value) => set('county', value)} onCity={(value) => set('city', value)} invalid={{ county: errors.county, city: errors.city }} />
        <div className="col-md-6"><label className="form-label" htmlFor="company-iban">{t('iban')}</label><input id="company-iban" className={`form-control text-uppercase ${field('iban')}`} spellCheck={false} value={profile.iban ?? ''} onChange={(event) => set('iban', event.target.value)} />{feedback('iban')}</div>
        <div className="col-md-6"><label className="form-label" htmlFor="company-bank">{t('bank')}</label><input id="company-bank" className="form-control" maxLength={80} value={profile.bank ?? ''} onChange={(event) => set('bank', event.target.value)} /></div>
        <div className="col-md-6"><label className="form-label" htmlFor="company-email">{t('email')}</label><input id="company-email" type="email" className="form-control" value={profile.email ?? ''} onChange={(event) => set('email', event.target.value)} /></div>
        <div className="col-md-6"><label className="form-label" htmlFor="company-phone">{t('phone')}</label><input id="company-phone" type="tel" className="form-control" value={profile.phone ?? ''} onChange={(event) => set('phone', event.target.value)} /></div>
        <div className="col-12"><span className="form-label d-block mb-0">{t('invoiceSettings')}</span></div>
        <div className="col-6 col-md-3"><label className="form-label required" htmlFor="company-series">{t('invoiceSeries')}</label><input id="company-series" className={`form-control text-uppercase ${field('series')}`} maxLength={10} value={profile.invoiceSeries} onChange={(event) => set('invoiceSeries', event.target.value.toUpperCase())} />{feedback('series')}</div>
        <div className="col-6 col-md-3"><label className="form-label required" htmlFor="company-number">{t('nextNumber')}</label><input id="company-number" type="number" min="1" step="1" className={`form-control ${field('number')}`} value={profile.nextInvoiceNumber} onChange={(event) => set('nextInvoiceNumber', Number(event.target.value))} />{feedback('number')}</div>
        <div className="col-6 col-md-3"><label className="form-label" htmlFor="company-rate">{t('defaultVatRate')}</label><div className="input-group"><input id="company-rate" type="number" min="0" max="100" step="1" disabled={!profile.vatPayer} className={`form-control ${field('vat')}`} value={profile.defaultVatRate} onChange={(event) => set('defaultVatRate', Number(event.target.value))} /><span className="input-group-text">%</span>{feedback('vat')}</div></div>
        <div className="col-6 col-md-3"><label className="form-label" htmlFor="company-days">{t('paymentTerm')}</label><div className="input-group"><input id="company-days" type="number" min="0" max="365" step="1" className={`form-control ${field('days')}`} value={profile.paymentDays} onChange={(event) => set('paymentDays', Number(event.target.value))} /><span className="input-group-text">{t('daysShort')}</span>{feedback('days')}</div></div>
        <div className="col-12"><label className="form-label" htmlFor="company-note">{t('invoiceFooterNote')}</label><input id="company-note" className="form-control" maxLength={200} value={profile.invoiceNote ?? ''} onChange={(event) => set('invoiceNote', event.target.value)} /><div className="form-text">{t('seriesHint')}</div></div>
        {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
        <div className="col-12 d-flex justify-content-end"><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
      </div>}
    </form>
  </section>;
}
