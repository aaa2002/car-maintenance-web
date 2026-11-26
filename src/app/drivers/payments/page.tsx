'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { DateField } from '@/components/date-field';
import { DriverSubnav } from '@/components/driver-subnav';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, Modal, PageHeader, SectionHeader, SetupBanner, StatusPill, useToast } from '@/components/ui';
import { useWeekParam, WeekPicker } from '@/components/week-picker';
import { getDrivers, getSettlementsForWeek, markSettlementPaid, type Driver, type PaymentMethod, type Settlement } from '@/lib/drivers';
import { addDays, errorMessage, localDate, money, today } from '@/lib/format';
import { downloadBlob, getCompanyProfile, getInvoices, invoiceCode, profileGaps, type CompanyProfile, type Invoice } from '@/lib/invoicing';

const METHODS: PaymentMethod[] = ['bank', 'cash', 'other'];
const round = (value: number) => Math.round(value * 100) / 100;

/** Bank batch file: one transfer per payout, in the columns most Romanian internet banking imports accept. */
function transfersCsv(rows: { driver: Driver; settlement: Settlement }[], week: string) {
  const reference = `Plata saptamana ${week.slice(8, 10)}.${week.slice(5, 7)}-${addDays(week, 6).slice(8, 10)}.${addDays(week, 6).slice(5, 7)}.${week.slice(0, 4)}`;
  const cell = (value: string) => (/[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = rows.map(({ driver, settlement }) => [driver.billing.name || driver.fullName, driver.iban ?? '', Math.abs(settlement.outstandingAmount).toFixed(2), settlement.currency, reference].map(cell).join(';'));
  return '﻿' + ['Beneficiar;IBAN;Suma;Moneda;Detalii plata', ...lines].join('\r\n');
}

export default function PayoutsPage() {
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const { week, setWeek, ready } = useWeekParam();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState<Settlement[] | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user || !ready) return;
    setError(undefined);
    try {
      const [nextSettlements, nextDrivers, nextInvoices, nextProfile] = await Promise.all([getSettlementsForWeek(week), getDrivers(), getInvoices({ from: week, to: addDays(week, 60) }), getCompanyProfile()]);
      setProfile(nextProfile); setSettlements(nextSettlements); setDrivers(nextDrivers); setInvoices(nextInvoices.filter((invoice) => invoice.weekStart === week)); setSelected(new Set());
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, ready, week]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => settlements.flatMap((settlement) => {
    const driver = drivers.find((value) => value.id === settlement.driverId);
    return driver ? [{ driver, settlement, invoice: invoices.find((invoice) => invoice.settlementId === settlement.id && invoice.status === 'issued' && !invoice.stornoOf) ?? null }] : [];
  }).sort((a, b) => Number(a.settlement.status === 'paid') - Number(b.settlement.status === 'paid') || a.driver.fullName.localeCompare(b.driver.fullName)), [settlements, drivers, invoices]);
  const missing = drivers.filter((driver) => driver.active && !settlements.some((settlement) => settlement.driverId === driver.id));
  const currencies = [...new Set(settlements.map((settlement) => settlement.currency))];
  const currency = currencies.length === 1 ? currencies[0] : 'RON';
  const totals = settlements.filter((settlement) => settlement.currency === currency).reduce((sum, settlement) => ({
    toDrivers: sum.toDrivers + Math.max(settlement.netAmount, 0), fromDrivers: sum.fromDrivers + Math.max(-settlement.netAmount, 0),
    openToDrivers: sum.openToDrivers + Math.max(settlement.outstandingAmount, 0), openFromDrivers: sum.openFromDrivers + Math.max(-settlement.outstandingAmount, 0),
  }), { toDrivers: 0, fromDrivers: 0, openToDrivers: 0, openFromDrivers: 0 });
  const transferRows = rows.filter(({ settlement }) => settlement.outstandingAmount > 0.005);
  const withoutIban = transferRows.filter(({ driver }) => !driver.iban);
  const unpaidSelected = rows.filter(({ settlement }) => selected.has(settlement.id) && settlement.status !== 'paid').map(({ settlement }) => settlement);

  const fmt = (value: number, code = currency) => money(value, code, language);
  const statusTone = { paid: 'success', partial: 'warning', unpaid: 'danger' } as const;
  const statusLabel = { paid: t('settlementPaid'), partial: t('settlementPartial'), unpaid: t('settlementUnpaid') } as const;
  const toggle = (id: number, value: boolean) => setSelected((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });

  return <AppShell>
    <PageHeader title={t('payouts')} subtitle={t('payoutsSubtitle')} />
    <DriverSubnav />
    <div className="toolbar"><WeekPicker id="payouts-week" week={week} onChange={setWeek} />
      <div className="ms-auto d-flex flex-wrap gap-2">
        <Link href={`/drivers/import?week=${week}`} className="btn btn-sm btn-outline-secondary"><i className="bi bi-upload me-2" />{t('import')}</Link>
        {transferRows.length > 0 && <button className="btn btn-sm btn-outline-secondary" onClick={() => downloadBlob(new Blob([transfersCsv(transferRows.filter(({ driver }) => driver.iban), week)], { type: 'text/csv;charset=utf-8' }), `plati-soferi-${week}.csv`)}><i className="bi bi-bank me-2" />{t('exportTransfers')}</button>}
      </div>
    </div>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}

    {settlements.length > 0 && <div className="app-panel stat-strip">
      <div className="stat-item"><span className="metric-label">{t('payoutsToDrivers')}</span><strong className="metric-value">{fmt(totals.toDrivers)}</strong>{totals.openToDrivers > 0.005 && <span className="small text-warning">{t('stillToPay').replace('{amount}', fmt(totals.openToDrivers))}</span>}</div>
      <div className="stat-item"><span className="metric-label">{t('owedByDrivers')}</span><strong className="metric-value">{fmt(totals.fromDrivers)}</strong>{totals.openFromDrivers > 0.005 && <span className="small text-warning">{t('stillToCollect').replace('{amount}', fmt(totals.openFromDrivers))}</span>}</div>
      <div className="stat-item"><span className="metric-label">{t('weeksPaid')}</span><strong className="metric-value">{settlements.filter((settlement) => settlement.status === 'paid').length} / {settlements.length}</strong></div>
      <div className="stat-item"><span className="metric-label">{t('invoicesIssued')}</span><strong className="metric-value">{rows.filter((row) => row.invoice).length} / {rows.length}</strong></div>
    </div>}
    {withoutIban.length > 0 && <SetupBanner icon="bi-bank" title={t('ibansMissingTitle').replace('{n}', String(withoutIban.length))} text={t('missingIbans').replace('{names}', withoutIban.map(({ driver }) => driver.fullName).join(', '))} action={<Link href={`/drivers/${withoutIban[0].driver.id}?edit=1`} className="btn btn-sm btn-primary">{t('addIban')}</Link>} />}
    {profile !== undefined && profileGaps(profile).length > 0 && settlements.length > 0 && <SetupBanner tone="info" icon="bi-building" title={t('companyProfileMissing')} text={t('payoutsCompanyHint')} action={<Link href="/settings#company" className="btn btn-sm btn-outline-secondary">{t('setUpCompany')}</Link>} />}

    <section>
      <SectionHeader title={t('weekOf').replace('{date}', localDate(week, language))} action={unpaidSelected.length > 0 && <button className="btn btn-sm btn-primary" onClick={() => setPaying(unpaidSelected)}><i className="bi bi-check2-all me-2" />{t('markSelectedPaid').replace('{n}', String(unpaidSelected.length))}</button>} />
      {loading ? <ListSkeleton rows={4} /> : rows.length ? <div className="data-list">{rows.map(({ driver, settlement, invoice }) => {
        const owes = settlement.netAmount < 0;
        return <div className="data-row payout-row" key={settlement.id}>
          <input type="checkbox" className="form-check-input flex-shrink-0" aria-label={`${t('include')} ${driver.fullName}`} disabled={settlement.status === 'paid'} checked={selected.has(settlement.id)} onChange={(event) => toggle(settlement.id, event.target.checked)} />
          <span className="data-row-main">
            <Link href={`/drivers/${driver.id}`} className="data-row-title text-decoration-none text-body">{driver.fullName}</Link>
            <span className="data-row-subtitle">{[settlement.vehicleLabel, settlement.cashCollected > 0 ? `${t('cashCollected')} ${fmt(settlement.cashCollected, settlement.currency)}` : null, settlement.paidOn ? t('paidOnVia').replace('{date}', localDate(settlement.paidOn, language)).replace('{method}', t(`method_${settlement.paymentMethod ?? 'other'}`)) : null, !driver.iban && !owes && settlement.status !== 'paid' ? t('noIban') : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="payout-amount"><span className="metric-label">{owes ? t('driverOwes') : t('payoutToDriver')}</span><strong className={`num ${owes ? 'text-danger' : ''}`}>{fmt(Math.abs(settlement.netAmount), settlement.currency)}</strong>{settlement.status === 'partial' && <span className="small text-warning">{t('outstanding')} {fmt(Math.abs(settlement.outstandingAmount), settlement.currency)}</span>}</span>
          <StatusPill tone={statusTone[settlement.status]}>{statusLabel[settlement.status]}</StatusPill>
          <span className="d-flex gap-1">
            {settlement.status !== 'paid' && <button className="btn btn-sm btn-outline-secondary" onClick={() => setPaying([settlement])}><i className="bi bi-check2 me-sm-1" /><span className="d-none d-sm-inline">{owes ? t('markReceived') : t('markPaid')}</span></button>}
            <Link href={`/drivers/${driver.id}/statement?week=${week}`} className="icon-button" title={t('statement')}><i className="bi bi-file-earmark-text" /><span className="visually-hidden">{t('statement')}</span></Link>
            {invoice ? <Link href={`/drivers/invoices/${invoice.id}`} className="icon-button text-success" title={invoiceCode(invoice)}><i className="bi bi-receipt-cutoff" /><span className="visually-hidden">{invoiceCode(invoice)}</span></Link>
              : <Link href={`/drivers/invoices?week=${week}`} className="icon-button" title={t('issueInvoice')}><i className="bi bi-receipt" /><span className="visually-hidden">{t('issueInvoice')}</span></Link>}
          </span>
        </div>;
      })}</div> : <div className="app-panel"><Empty icon="bi-cash-stack" title={t('noPayoutsWeek')} text={t('noPayoutsWeekHint')} action={<Link href={`/drivers/import?week=${week}`} className="btn btn-primary">{t('importFromPlatforms')}</Link>} /></div>}
      {missing.length > 0 && rows.length > 0 && <p className="small text-body-secondary mt-3 mb-0">{t('driversWithoutWeek').replace('{names}', missing.map((driver) => driver.fullName).join(', '))}</p>}
    </section>

    <PayDialog settlements={paying} onClose={() => setPaying(null)} onSaved={async (count) => { await load(); toast(t('paymentsSaved').replace('{n}', String(count))); }} />
  </AppShell>;
}

/** Records a payout (or money received from a driver) for one week, or settles several weeks in full. */
function PayDialog({ settlements, onClose, onSaved }: { settlements: Settlement[] | null; onClose: () => void; onSaved: (count: number) => Promise<void> }) {
  const { t, language } = useSettings();
  const single = settlements?.length === 1 ? settlements[0] : null;
  const [amount, setAmount] = useState(''); const [paidOn, setPaidOn] = useState(today()); const [method, setMethod] = useState<PaymentMethod>('bank');
  const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settlements) return;
    setAmount(single ? String(round(Math.abs(single.netAmount))) : ''); setPaidOn(today()); setMethod(single && single.netAmount < 0 ? 'cash' : 'bank'); setFormError('');
  }, [settlements, single]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!settlements) return;
    const value = single ? Number(amount) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setFormError(t('invalidNumber')); return; }
    setBusy(true); setFormError('');
    try {
      for (const settlement of settlements) await markSettlementPaid(settlement, { amount: value ?? undefined, paidOn, method });
      await onSaved(settlements.length); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  const total = (settlements ?? []).reduce((sum, settlement) => sum + Math.abs(settlement.netAmount), 0);
  return <Modal title={single ? (single.netAmount < 0 ? t('markReceived') : t('markPaid')) : t('markSelectedPaid').replace('{n}', String(settlements?.length ?? 0))} show={settlements !== null} onClose={() => !busy && onClose()} variant="modal"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      {single ? <div className="col-12"><label className="form-label required" htmlFor="pay-amount">{t('totalSettled')}</label><div className="input-group"><input id="pay-amount" type="number" min="0" step="0.01" inputMode="decimal" className="form-control" value={amount} onChange={(event) => setAmount(event.target.value)} /><span className="input-group-text">{single.currency}</span></div><div className="form-text">{t('totalSettledHint').replace('{amount}', money(Math.abs(single.netAmount), single.currency, language))}</div></div>
        : <div className="col-12"><p className="mb-0 text-body-secondary">{t('settleAllHint').replace('{amount}', money(total, settlements?.[0]?.currency ?? 'RON', language))}</p></div>}
      <div className="col-sm-6"><label className="form-label required" htmlFor="pay-date">{t('paidOn')}</label><DateField id="pay-date" max={today()} value={paidOn} onChange={setPaidOn} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="pay-method">{t('paymentMethod')}</label><select id="pay-method" className="form-select" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{METHODS.map((value) => <option key={value} value={value}>{t(`method_${value}`)}</option>)}</select></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}
