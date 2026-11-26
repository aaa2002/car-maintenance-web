'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DriverSubnav } from '@/components/driver-subnav';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, StatusPill } from '@/components/ui';
import { useWeekParam, WeekPicker } from '@/components/week-picker';
import { getDrivers, type Driver } from '@/lib/drivers';
import { addDays, localDate, money } from '@/lib/format';
import { getPlatformEarnings, getRideInvoices, invoiceTotals, type PlatformEarning, type StoredRideInvoice } from '@/lib/imports';
import { downloadBlob } from '@/lib/invoicing';
import type { Platform } from '@/lib/platform-import';

const PLATFORMS: Platform[] = ['bolt', 'uber'];
const LABEL: Record<Platform, string> = { bolt: 'Bolt', uber: 'Uber' };
const round = (value: number) => Math.round(value * 100) / 100;

function ridesCsv(invoices: StoredRideInvoice[], drivers: Driver[], language: 'en' | 'ro') {
  const ro = language === 'ro';
  const header = ro ? ['Platformă', 'Număr factură', 'Data facturii', 'Data cursei', 'Șofer', 'Client', 'Valoare fără TVA', 'TVA', 'Total', 'Moneda', 'Plată']
    : ['Platform', 'Invoice number', 'Invoice date', 'Ride date', 'Driver', 'Rider', 'Net', 'VAT', 'Total', 'Currency', 'Payment'];
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : typeof value === 'number' ? value.toFixed(2).replace('.', ro ? ',' : '.') : value;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = invoices.map((invoice) => [LABEL[invoice.platform], invoice.number, invoice.issuedOn, invoice.rideAt?.replace('T', ' ').slice(0, 16) ?? '', drivers.find((driver) => driver.id === invoice.driverId)?.fullName ?? invoice.driverName,
    invoice.riderName ?? '', invoice.net, invoice.vat, invoice.total, invoice.currency, invoice.paymentMethod === 'cash' ? (ro ? 'Numerar' : 'Cash') : invoice.paymentMethod === 'app' ? (ro ? 'Aplicație' : 'App') : ''].map(cell).join(';'));
  return '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n');
}

export default function RideInvoicesPage() {
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { week, setWeek, ready } = useWeekParam();
  const [invoices, setInvoices] = useState<StoredRideInvoice[]>([]);
  const [earnings, setEarnings] = useState<PlatformEarning[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!user || !ready) return;
    setError(undefined); setLoading(true);
    try {
      const [nextInvoices, nextEarnings, nextDrivers] = await Promise.all([getRideInvoices({ from: week, to: week, withFiles: true }), getPlatformEarnings(week), getDrivers()]);
      setInvoices(nextInvoices); setEarnings(nextEarnings); setDrivers(nextDrivers);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, ready, week]);
  useEffect(() => { void load(); }, [load]);

  const shown = invoices.filter((invoice) => platform === 'all' || invoice.platform === platform);
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; driver: Driver | null; name: string; invoices: StoredRideInvoice[] }>();
    shown.forEach((invoice) => {
      const key = invoice.driverId ? `d${invoice.driverId}` : `n${invoice.driverName}`;
      const driver = drivers.find((value) => value.id === invoice.driverId) ?? null;
      const group = map.get(key) ?? { key, driver, name: driver?.fullName ?? invoice.driverName, invoices: [] };
      group.invoices.push(invoice); map.set(key, group);
    });
    // Drivers with reported earnings but no invoices this week also belong in the comparison.
    earnings.filter((row) => platform === 'all' || row.platform === platform).forEach((row) => {
      const key = `d${row.driverId}`;
      if (!map.has(key)) map.set(key, { key, driver: drivers.find((value) => value.id === row.driverId) ?? null, name: drivers.find((value) => value.id === row.driverId)?.fullName ?? row.platformName, invoices: [] });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [shown, drivers, earnings, platform]);
  const totals = invoiceTotals(shown);
  const unassigned = shown.filter((invoice) => !invoice.driverId).length;
  const currency = shown[0]?.currency ?? 'RON';
  const fmt = (value: number) => money(value, currency, language);

  async function downloadPdfs() {
    const withFiles = shown.filter((invoice) => invoice.fileUrl);
    setZipping({ done: 0, total: withFiles.length });
    try {
      const { zipSync, strToU8 } = await import('fflate');
      const files: Record<string, Uint8Array> = {};
      let done = 0;
      const queue = [...withFiles];
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let invoice = queue.shift(); invoice; invoice = queue.shift()) {
          const response = await fetch(invoice.fileUrl!);
          if (response.ok) files[`${LABEL[invoice.platform]}/${(drivers.find((driver) => driver.id === invoice.driverId)?.fullName ?? invoice.driverName).replace(/[\\/:*?"<>|]+/g, '_')}/${invoice.number}.pdf`] = new Uint8Array(await response.arrayBuffer());
          setZipping({ done: ++done, total: withFiles.length });
        }
      }));
      files[language === 'ro' ? 'facturi-curse.csv' : 'ride-invoices.csv'] = strToU8(ridesCsv(shown, drivers, language));
      downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `facturi-curse-${week}.zip`);
    } catch (caught) { setError(caught); }
    finally { setZipping(null); }
  }

  return <AppShell>
    <PageHeader title={t('rideInvoices')} subtitle={t('rideInvoicesSubtitle')} />
    <DriverSubnav />
    <div className="toolbar"><WeekPicker id="rides-week" week={week} onChange={setWeek} />
      <div className="segmented">{(['all', ...PLATFORMS] as const).map((value) => <button key={value} className={platform === value ? 'active' : ''} onClick={() => setPlatform(value)}>{value === 'all' ? t('allPlatforms') : LABEL[value]}</button>)}</div>
      <div className="ms-auto d-flex flex-wrap gap-2">
        <Link href={`/drivers/import?week=${week}`} className="btn btn-sm btn-outline-secondary"><i className="bi bi-upload me-2" />{t('import')}</Link>
        {shown.length > 0 && <button className="btn btn-sm btn-outline-secondary" onClick={() => downloadBlob(new Blob([ridesCsv(shown, drivers, language)], { type: 'text/csv;charset=utf-8' }), `facturi-curse-${week}.csv`)}><i className="bi bi-table me-2" />{t('exportCsv')}</button>}
        {shown.some((invoice) => invoice.fileUrl) && <button className="btn btn-sm btn-primary" disabled={Boolean(zipping)} onClick={() => void downloadPdfs()}>{zipping ? <><span className="spinner-border spinner-border-sm me-2" />{zipping.done}/{zipping.total}</> : <><i className="bi bi-file-earmark-zip me-2" />{t('downloadPdfsZip')}</>}</button>}
      </div>
    </div>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}

    {shown.length > 0 && <div className="app-panel stat-strip">
      <div className="stat-item"><span className="metric-label">{t('rideInvoices')}</span><strong className="metric-value">{totals.count}</strong></div>
      <div className="stat-item"><span className="metric-label">{t('invoicedTotal')}</span><strong className="metric-value">{fmt(totals.total)}</strong></div>
      <div className="stat-item"><span className="metric-label">{t('paidInCash')}</span><strong className="metric-value">{totals.knownMethod ? fmt(totals.cash) : '-'}</strong>{!totals.knownMethod && <span className="small text-body-secondary">{t('uberNoMethod')}</span>}</div>
      <div className="stat-item"><span className="metric-label">{t('drivers')}</span><strong className="metric-value">{groups.filter((group) => group.invoices.length).length}</strong>{unassigned > 0 && <span className="small text-warning">{t('invoicesUnassigned').replace('{n}', String(unassigned))}</span>}</div>
    </div>}

    <section>
      <SectionHeader title={t('reconciliation')} />
      {loading ? <ListSkeleton rows={4} /> : groups.length ? <div className="app-panel import-table-wrap"><table className="import-table">
        <thead><tr><th scope="col">{t('driver')}</th><th scope="col" className="num">{t('rideInvoicesShort')}</th><th scope="col" className="num">{t('invoicedTotal')}</th><th scope="col" className="num">{t('cashOnInvoices')}</th><th scope="col" className="num">{t('cashReported')}</th><th scope="col" className="num">{t('reportedGross')}</th><th scope="col">{t('check')}</th></tr></thead>
        <tbody>{groups.map((group) => {
          const byPlatform = PLATFORMS.filter((value) => platform === 'all' || value === platform).map((value) => ({ platform: value, invoices: invoiceTotals(group.invoices.filter((invoice) => invoice.platform === value)), earning: group.driver ? earnings.find((row) => row.driverId === group.driver!.id && row.platform === value) : undefined })).filter((row) => row.invoices.count || row.earning);
          return byPlatform.map((row, index) => {
            const cashGap = row.platform === 'bolt' && row.earning && row.invoices.knownMethod ? round(row.invoices.cash - row.earning.cash) : null;
            const tone = !row.earning ? 'warning' : !row.invoices.count ? 'warning' : cashGap !== null && Math.abs(cashGap) > Math.max(5, row.earning.cash * 0.02) ? 'warning' : 'success';
            const label = !row.earning ? t('noEarningsImported') : !row.invoices.count ? t('noInvoicesImported') : cashGap !== null && tone === 'warning' ? t('cashGap').replace('{amount}', fmt(Math.abs(cashGap))) : t('looksRight');
            return <tr key={`${group.key}-${row.platform}`} className="is-clickable" onClick={() => setOpen(open === `${group.key}-${row.platform}` ? null : `${group.key}-${row.platform}`)}>
              <th scope="row">{index === 0 ? <>{group.driver ? <Link href={`/drivers/${group.driver.id}`} onClick={(event) => event.stopPropagation()}>{group.name}</Link> : group.name}{!group.driver && <span className="d-block small text-warning fw-normal">{t('notMatchedToDriver')}</span>}</> : null}<span className="d-block small text-body-secondary fw-normal">{LABEL[row.platform]}</span></th>
              <td className="num">{row.invoices.count || '-'}</td>
              <td className="num">{row.invoices.count ? fmt(row.invoices.total) : '-'}</td>
              <td className="num">{row.invoices.knownMethod ? fmt(row.invoices.cash) : '-'}</td>
              <td className="num">{row.earning ? fmt(row.earning.cash) : '-'}</td>
              <td className="num">{row.earning ? fmt(row.earning.gross) : '-'}</td>
              <td><StatusPill tone={tone}>{label}</StatusPill></td>
            </tr>;
          });
        })}</tbody>
      </table></div> : <div className="app-panel"><Empty icon="bi-receipt" title={t('noRideInvoices')} text={t('noRideInvoicesHint')} action={<Link href={`/drivers/import?week=${week}`} className="btn btn-primary">{t('importFromPlatforms')}</Link>} /></div>}
      {groups.length > 0 && <p className="small text-body-secondary mt-3 mb-0">{t('reconcileHint')}</p>}
    </section>

    {shown.length > 0 && <section className="section-gap mt-4">
      <SectionHeader title={t('invoiceList')} />
      <div className="data-list">{groups.filter((group) => group.invoices.length).map((group) => {
        const key = group.key; const expanded = open?.startsWith(`${key}-`) || open === key;
        return <div key={key}>
          <button type="button" className="data-row data-row-action w-100 text-start" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
            <span className="row-icon tone-brand"><i className="bi bi-person" /></span>
            <span className="data-row-main"><span className="data-row-title">{group.name}</span><span className="data-row-subtitle">{t('ridesCount').replace('{n}', String(group.invoices.length))}</span></span>
            <strong className="num">{fmt(invoiceTotals(group.invoices).total)}</strong>
            <i className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-body-secondary`} />
          </button>
          {expanded && <div className="import-table-wrap"><table className="import-table ride-table"><tbody>{group.invoices.map((invoice) => <tr key={invoice.id}>
            <td className="text-nowrap">{invoice.rideAt ? `${localDate(invoice.rideAt.slice(0, 10), language)} ${invoice.rideAt.slice(11, 16)}` : localDate(invoice.issuedOn, language)}</td>
            <td><StatusPill tone="neutral">{LABEL[invoice.platform]}</StatusPill> <span className="font-monospace small">{invoice.number}</span></td>
            <td className="text-body-secondary">{invoice.riderName ?? ''}{invoice.pickup ? <span className="d-block small">{invoice.pickup}</span> : null}</td>
            <td>{invoice.paymentMethod ? <StatusPill tone={invoice.paymentMethod === 'cash' ? 'warning' : 'info'}>{invoice.paymentMethod === 'cash' ? t('cash') : t('inApp')}</StatusPill> : null}</td>
            <td className="num">{money(invoice.total, invoice.currency, language)}</td>
            <td>{invoice.fileUrl && <a href={invoice.fileUrl} target="_blank" rel="noreferrer" className="icon-button" title="PDF"><i className="bi bi-file-earmark-pdf" /><span className="visually-hidden">PDF</span></a>}</td>
          </tr>)}</tbody></table></div>}
        </div>;
      })}</div>
      <p className="small text-body-secondary mt-3 mb-0">{t('weekRange').replace('{from}', localDate(week, language)).replace('{to}', localDate(addDays(week, 6), language))}</p>
    </section>}
  </AppShell>;
}
