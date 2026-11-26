'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DateField } from '@/components/date-field';
import { DriverSubnav } from '@/components/driver-subnav';
import { InvoiceDraftDialog, invoiceErrorMessage } from '@/components/invoice-forms';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, SetupBanner, StatusPill, useToast } from '@/components/ui';
import { useWeekParam, WeekPicker } from '@/components/week-picker';
import { getDrivers, getSettlementsForWeek, type Driver, type Settlement } from '@/lib/drivers';
import { addDays, localDate, money, monthRange, today } from '@/lib/format';
import { buyerGaps, downloadBlob, draftTotals, getCompanyProfile, getInvoices, invoiceCode, invoiceRegisterCsv, issueInvoice, linesFromSettlement, profileGaps, type CompanyProfile, type Invoice } from '@/lib/invoicing';

export default function InvoicesPage() {
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const { week, setWeek, ready } = useWeekParam();
  const [offset, setOffset] = useState(0);
  const period = monthRange(offset, language);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [weekInvoices, setWeekInvoices] = useState<Invoice[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [withFines, setWithFines] = useState(false); const [withExpenses, setWithExpenses] = useState(false);
  const [issueDate, setIssueDate] = useState(today());
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [draft, setDraft] = useState<{ settlement: Settlement | null } | null>(null);
  const [search, setSearch] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    try { const [nextProfile, nextDrivers] = await Promise.all([getCompanyProfile(), getDrivers()]); setProfile(nextProfile); setDrivers(nextDrivers); setProfileLoaded(true); }
    catch (caught) { setError(caught); }
  }, [user]);
  const loadWeek = useCallback(async () => {
    if (!user || !ready) return;
    try {
      const [nextSettlements, nextInvoices] = await Promise.all([getSettlementsForWeek(week), getInvoices({ from: addDays(week, -7), to: addDays(week, 90) })]);
      setSettlements(nextSettlements); setWeekInvoices(nextInvoices.filter((invoice) => invoice.weekStart === week)); setPicked({});
    } catch (caught) { setError(caught); }
  }, [user, ready, week]);
  const loadList = useCallback(async () => {
    if (!user) return;
    try { setInvoices(await getInvoices({ from: period.from, to: period.to })); }
    catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, period.from, period.to]);
  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => { void loadWeek(); }, [loadWeek]);
  useEffect(() => { void loadList(); }, [loadList]);
  const reloadAll = async () => { await Promise.all([loadProfile(), loadWeek(), loadList()]); };

  const gaps = profileGaps(profile);
  const candidates = useMemo(() => settlements.flatMap((settlement) => {
    const driver = drivers.find((value) => value.id === settlement.driverId);
    if (!driver || !profile) return [];
    const issued = weekInvoices.find((invoice) => invoice.settlementId === settlement.id && invoice.status === 'issued' && !invoice.stornoOf) ?? null;
    const lines = linesFromSettlement(settlement, profile, { fines: withFines, expenses: withExpenses }, 'ro');
    return [{ settlement, driver, issued, lines, totals: draftTotals(lines, profile.vatPayer), gaps: buyerGaps(driver) }];
  }).sort((a, b) => a.driver.fullName.localeCompare(b.driver.fullName)), [settlements, drivers, profile, weekInvoices, withFines, withExpenses]);
  const isPicked = (candidate: (typeof candidates)[number]) => !candidate.issued && candidate.lines.length > 0 && !candidate.gaps.length && (picked[candidate.settlement.id] ?? true);
  const toIssue = candidates.filter(isPicked);

  async function issueWeek() {
    setError(undefined);
    setBusy({ label: t('issuingInvoices'), done: 0, total: toIssue.length });
    let issued = 0;
    try {
      for (const candidate of toIssue) {
        await issueInvoice({ driverId: candidate.driver.id, settlementId: candidate.settlement.id, issueDate, dueDate: addDays(issueDate, profile!.paymentDays), currency: candidate.settlement.currency, lines: candidate.lines, notes: t('invoiceWeekNote') });
        issued += 1; setBusy((current) => current && { ...current, done: issued });
      }
      toast(t('invoicesIssuedToast').replace('{n}', String(issued)));
    } catch (caught) { setError(new Error(invoiceErrorMessage(caught, t))); }
    finally { setBusy(null); await reloadAll(); }
  }

  const visible = invoices.filter((invoice) => !search.trim() || `${invoiceCode(invoice)} ${invoice.buyer.name} ${invoice.buyer.taxId ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const totalsByCurrency = visible.filter((invoice) => invoice.status === 'issued' || invoice.stornoOf).reduce((map, invoice) => map.set(invoice.currency, (map.get(invoice.currency) ?? 0) + invoice.total), new Map<string, number>());
  async function exportZip() {
    setBusy({ label: t('preparingZip'), done: 0, total: visible.length });
    try {
      const { invoicesZip } = await import('@/lib/invoice-pdf');
      const data = await invoicesZip(visible, language, (done, total) => setBusy({ label: t('preparingZip'), done, total }));
      downloadBlob(new Blob([data as BlobPart], { type: 'application/zip' }), `facturi-${period.from.slice(0, 7)}.zip`);
    } catch (caught) { setError(caught); }
    finally { setBusy(null); }
  }
  const exportRegister = () => downloadBlob(new Blob([invoiceRegisterCsv(visible, language)], { type: 'text/csv;charset=utf-8' }), `registru-facturi-${period.from.slice(0, 7)}.csv`);
  const fmt = (value: number, currency: 'RON' | 'EUR') => money(value, currency, language);

  return <AppShell>
    <PageHeader title={t('invoices')} subtitle={t('invoicesSubtitle')} action={profile && !gaps.length && <button className="btn btn-primary btn-island" onClick={() => setDraft({ settlement: null })} aria-label={t('newInvoice')}><span className="d-none d-sm-inline">{t('newInvoice')}</span><span className="btn-island-icon"><i className="bi bi-plus-lg" /></span></button>} />
    <DriverSubnav />
    {Boolean(error) && <ErrorAlert error={error} />}
    {profileLoaded && gaps.length > 0 && <SetupBanner icon="bi-building-exclamation" title={t('companyProfileMissing')} text={t('companyProfileMissingHint')} action={<Link href="/settings#company" className="btn btn-sm btn-primary">{t('setUpCompany')}</Link>} />}

    {profile && !gaps.length && <section className="section-gap">
      <SectionHeader title={t('invoiceAWeek')} />
      <div className="toolbar mb-3"><WeekPicker id="invoices-week" week={week} onChange={setWeek} /></div>
      {candidates.some((candidate) => candidate.gaps.length && !candidate.issued) && (() => {
        const blocked = candidates.filter((candidate) => candidate.gaps.length && !candidate.issued);
        return <SetupBanner icon="bi-geo-alt" title={t('billingMissingTitle').replace('{n}', String(blocked.length))} text={t('billingMissingText').replace('{names}', blocked.map((candidate) => candidate.driver.fullName).join(', '))} action={<Link href={`/drivers/${blocked[0].driver.id}?edit=1`} className="btn btn-sm btn-primary">{t('addBillingDetails')}</Link>} />;
      })()}
      {candidates.length ? <>
        <div className="data-list">{candidates.map((candidate) => {
          const checked = isPicked(candidate);
          return <div className={`data-row ${candidate.issued ? '' : ''}`} key={candidate.settlement.id}>
            <input type="checkbox" className="form-check-input flex-shrink-0" aria-label={candidate.driver.fullName} disabled={Boolean(candidate.issued) || !candidate.lines.length || candidate.gaps.length > 0} checked={checked} onChange={(event) => setPicked((current) => ({ ...current, [candidate.settlement.id]: event.target.checked }))} />
            <span className="data-row-main">
              <span className="data-row-title">{candidate.driver.billing.name || candidate.driver.fullName}</span>
              <span className="data-row-subtitle">{candidate.lines.length ? candidate.lines.map((line) => line.description.split(',')[0]).join(' · ') : t('nothingToInvoice')}{candidate.gaps.length > 0 && !candidate.issued && <> · <Link href={`/drivers/${candidate.driver.id}?edit=1`} className="text-warning">{t('buyerIncomplete')}</Link></>}</span>
            </span>
            {candidate.issued ? <Link href={`/drivers/invoices/${candidate.issued.id}`} className="text-decoration-none"><StatusPill tone="success">{invoiceCode(candidate.issued)}</StatusPill></Link>
              : candidate.lines.length > 0 && <strong className="num text-nowrap">{fmt(candidate.totals.total, candidate.settlement.currency)}</strong>}
            {!candidate.issued && candidate.lines.length > 0 && !candidate.gaps.length && <button type="button" className="icon-button" title={t('reviewAndEdit')} onClick={() => setDraft({ settlement: candidate.settlement })}><i className="bi bi-pencil" /><span className="visually-hidden">{t('reviewAndEdit')}</span></button>}
          </div>;
        })}</div>
        <div className="app-panel app-panel-body mt-3"><div className="row g-3 align-items-end">
          <div className="col-sm-4"><label className="form-label" htmlFor="bulk-issue-date">{t('issueDate')}</label><DateField id="bulk-issue-date" value={issueDate} onChange={setIssueDate} /></div>
          <div className="col-sm-8 d-flex flex-wrap gap-3 pb-2">
            <div className="form-check"><input id="bulk-fines" type="checkbox" className="form-check-input" checked={withFines} onChange={(event) => setWithFines(event.target.checked)} /><label className="form-check-label" htmlFor="bulk-fines">{t('invoiceFinesToo')}</label></div>
            <div className="form-check"><input id="bulk-expenses" type="checkbox" className="form-check-input" checked={withExpenses} onChange={(event) => setWithExpenses(event.target.checked)} /><label className="form-check-label" htmlFor="bulk-expenses">{t('invoiceExpensesToo')}</label></div>
          </div>
          <div className="col-12 d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span className="small text-body-secondary">{t('bulkInvoiceHint').replace('{series}', profile.invoiceSeries).replace('{next}', String(profile.nextInvoiceNumber))}</span>
            <button className="btn btn-primary" disabled={!toIssue.length || Boolean(busy)} onClick={() => void issueWeek()}>{busy?.label === t('issuingInvoices') && <span className="spinner-border spinner-border-sm me-2" />}{busy?.label === t('issuingInvoices') ? `${busy.done}/${busy.total}` : (toIssue.length === 1 ? t('issueOneInvoice') : t('issueNInvoices').replace('{n}', String(toIssue.length)))}</button>
          </div>
        </div></div>
      </> : <div className="app-panel"><Empty icon="bi-calendar-week" title={t('noPayoutsWeek')} text={t('invoiceNeedsWeek')} /></div>}
    </section>}

    <section>
      <SectionHeader title={`${t('issuedInvoices')} · ${period.label}`} action={<div className="segmented">
        <button aria-label={t('previous')} onClick={() => setOffset((value) => value - 1)}><i className="bi bi-chevron-left" /></button>
        <button className={!offset ? 'active' : ''} onClick={() => setOffset(0)}>{t('thisMonth')}</button>
        <button aria-label={t('next')} disabled={offset >= 0} onClick={() => setOffset((value) => value + 1)}><i className="bi bi-chevron-right" /></button>
      </div>} />
      {invoices.length > 0 && <div className="toolbar">
        <input type="search" className="form-control form-control-sm invoice-search" placeholder={t('searchInvoices')} aria-label={t('searchInvoices')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="ms-auto d-flex flex-wrap gap-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={!visible.length || Boolean(busy)} onClick={exportRegister}><i className="bi bi-table me-2" />{t('exportRegister')}</button>
          <button className="btn btn-sm btn-primary" disabled={!visible.length || Boolean(busy)} onClick={() => void exportZip()}>{busy?.label === t('preparingZip') ? <><span className="spinner-border spinner-border-sm me-2" />{busy.done}/{busy.total}</> : <><i className="bi bi-file-earmark-zip me-2" />{t('downloadZip')}</>}</button>
        </div>
      </div>}
      {loading ? <ListSkeleton rows={4} /> : visible.length ? <>
        <div className="data-list">{visible.map((invoice) => <Link href={`/drivers/invoices/${invoice.id}`} className="data-row" key={invoice.id}>
          <span className={`row-icon ${invoice.status === 'cancelled' ? '' : invoice.stornoOf ? 'tone-danger' : 'tone-brand'}`}><i className={`bi ${invoice.stornoOf ? 'bi-arrow-counterclockwise' : 'bi-receipt-cutoff'}`} /></span>
          <span className="data-row-main"><span className="data-row-title">{invoiceCode(invoice)} · {invoice.buyer.name}</span><span className="data-row-subtitle">{localDate(invoice.issueDate, language)}{invoice.weekStart ? ` · ${t('weekOf').replace('{date}', localDate(invoice.weekStart, language))}` : ''}</span></span>
          {invoice.status === 'cancelled' && <StatusPill tone="neutral">{t('reversed')}</StatusPill>}
          {invoice.stornoOf && <StatusPill tone="danger">Storno</StatusPill>}
          <strong className={`num text-nowrap ${invoice.status === 'cancelled' ? 'text-body-secondary text-decoration-line-through' : ''}`}>{fmt(invoice.total, invoice.currency)}</strong>
          <i className="bi bi-chevron-right text-body-secondary" />
        </Link>)}</div>
        <p className="small text-body-secondary mt-3 mb-0">{[...totalsByCurrency].map(([currency, total]) => t('periodInvoiced').replace('{amount}', fmt(total, currency as 'RON' | 'EUR'))).join(' · ')} · {t('zipContents')}</p>
      </> : <div className="app-panel"><Empty icon="bi-receipt" title={t('noInvoices')} text={t('noInvoicesHint')} /></div>}
    </section>

    {profile && <InvoiceDraftDialog show={draft !== null} profile={profile} drivers={drivers} settlement={draft?.settlement ?? null} onClose={() => setDraft(null)} onIssued={async () => { toast(t('invoiceIssued')); await reloadAll(); }} />}
  </AppShell>;
}
