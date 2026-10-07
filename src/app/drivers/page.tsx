'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DriverForm } from '@/components/driver-forms';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { consumptionOf, contribution, getDriverReport, type DriverReportRow } from '@/lib/drivers';
import { money, monthRange, number } from '@/lib/format';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

function toCsv(rows: DriverReportRow[], currency: string) {
  const header = ['Driver', 'Active', 'Vehicles', 'Trips', 'Distance (km)', 'Fuel (L)', `Fuel cost (${currency})`, 'Repairs', `Repair cost (${currency})`, 'Weeks',
    `Gross earnings (${currency})`, `Vehicle rent (${currency})`, `Fleet commission (${currency})`, `Fines (${currency})`, `Payout (${currency})`,
    `Settled (${currency})`, `Outstanding in period (${currency})`, `Open balance (${currency})`, `Contribution (${currency})`];
  const cell = (value: string | number | boolean | null) => {
    const text = value === null ? '' : typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map((row) => [row.fullName, row.active, row.vehicles, row.trips, row.distance, row.fuelUsed, row.fuelCost, row.repairs, row.repairCost, row.weeks,
    row.grossEarnings, row.vehicleRent, row.fleetCommission, row.fines, row.payout, row.settled, row.outstanding, row.outstandingAllTime, contribution(row)].map(cell).join(','));
  return [header.map(cell).join(','), ...lines].join('\n');
}

export default function DriversPage() {
  const { t, language, currency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<DriverReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [adding, setAdding] = useState(false);
  const period = monthRange(offset, language);

  const load = useCallback(async () => {
    if (!user) return;
    setError(undefined);
    try { setRows(await getDriverReport(period.from, period.to, currency)); }
    catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, period.from, period.to, currency]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    active: sum.active + (row.active ? 1 : 0), earnings: sum.earnings + row.grossEarnings, income: sum.income + row.vehicleRent + row.fleetCommission,
    open: sum.open + row.outstandingAllTime, fuel: sum.fuel + row.fuelUsed, distance: sum.distance + row.distance,
  }), { active: 0, earnings: 0, income: 0, open: 0, fuel: 0, distance: 0 }), [rows]);
  const fleetConsumption = consumptionOf(totals.fuel, totals.distance);
  // Ranked by what each driver contributes to the fleet in the period.
  const ranked = useMemo(() => [...rows].sort((a, b) => Number(b.active) - Number(a.active) || contribution(b) - contribution(a)), [rows]);

  function exportCsv() {
    const blob = new Blob(['﻿' + toCsv(ranked, currency)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `vehix-drivers-${period.from.slice(0, 7)}.csv` });
    link.click(); URL.revokeObjectURL(url);
  }

  const openTone = (value: number) => (value > 0.005 ? 'warning' : value < -0.005 ? 'danger' : 'success');
  // Positive balances are payouts still owed to the driver; negative ones are money the driver owes the fleet.
  const balanceLabel = (value: number) => (value > 0.005 ? t('payoutToDriver') : value < -0.005 ? t('driverOwes') : t('openBalance'));

  return (
    <AppShell>
      <PageHeader
        title={t('drivers')}
        subtitle={period.label}
        action={<button className="btn btn-primary btn-island" onClick={() => setAdding(true)} aria-label={t('addDriver')}><span className="d-none d-sm-inline">{t('addDriver')}</span><span className="btn-island-icon"><i className="bi bi-plus-lg" /></span></button>}
      />
      <div className="toolbar">
        <div className="segmented">
          <button aria-label={t('previous')} onClick={() => setOffset((value) => value - 1)}><i className="bi bi-chevron-left" /></button>
          <button className={!offset ? 'active' : ''} onClick={() => setOffset(0)}>{t('thisMonth')}</button>
          <button aria-label={t('next')} disabled={offset >= 0} onClick={() => setOffset((value) => value + 1)}><i className="bi bi-chevron-right" /></button>
        </div>
        {rows.length > 0 && <button className="btn btn-sm btn-outline-secondary" onClick={exportCsv}><i className="bi bi-download me-2" />{t('exportCsv')}</button>}
      </div>
      {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}

      {rows.length > 0 && (
        <div className="app-panel stat-strip">
          <div className="stat-item"><span className="metric-label">{t('drivers')}</span><strong className="metric-value">{totals.active}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('earnings')}</span><strong className="metric-value">{money(totals.earnings, currency, language)}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('vehicleRent')} + {t('fleetCommission').toLowerCase()}</span><strong className="metric-value">{money(totals.income, currency, language)}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('openBalance')}</span><strong className="metric-value">{money(totals.open, currency, language)}</strong></div>
        </div>
      )}

      <section>
        <SectionHeader title={t('drivers')} action={fleetConsumption !== null && <span className="small text-body-secondary num">{t('fleetAverage').replace('{value}', `${number(fleetConsumption, language)} L/100 km`)}</span>} />
        {loading ? <ListSkeleton rows={3} /> : ranked.length ? (
          <div className="data-list">
            {ranked.map((row, index) => {
              const own = consumptionOf(row.fuelUsed, row.distance);
              return (
                <Link href={`/drivers/${row.driverId}`} key={row.driverId} className="data-row driver-row reveal" style={stagger(index)}>
                  <span className={`driver-avatar ${row.active ? '' : 'inactive'}`} aria-hidden="true">{initials(row.fullName)}</span>
                  <span className="data-row-main">
                    <span className="data-row-title">{row.fullName}{!row.active && <span className="ms-2"><StatusPill tone="neutral">{t('inactive')}</StatusPill></span>}</span>
                    <span className="data-row-subtitle">{row.vehicles ?? t('noVehicleAssigned')}{row.distance > 0 ? ` · ${number(row.distance, language, 0)} km` : ''}{own !== null ? ` · ${number(own, language)} L/100` : ''}</span>
                  </span>
                  <span className="driver-figures">
                    <span><span className="metric-label">{t('contribution')}</span><strong className="num">{money(contribution(row), currency, language)}</strong></span>
                    <span><span className="metric-label">{balanceLabel(row.outstandingAllTime)}</span><StatusPill tone={openTone(row.outstandingAllTime)}>{money(Math.abs(row.outstandingAllTime), currency, language)}</StatusPill></span>
                  </span>
                  <i className="bi bi-chevron-right text-body-secondary" />
                </Link>
              );
            })}
          </div>
        ) : <div className="app-panel"><Empty icon="bi-people" title={t('noDrivers')} text={t('noDriversHint')} action={<button className="btn btn-primary" onClick={() => setAdding(true)}>{t('addDriver')}</button>} /></div>}
        {rows.length > 0 && <p className="small text-body-secondary mt-3 mb-0">{t('contributionHint')}</p>}
      </section>

      <DriverForm show={adding} onClose={() => setAdding(false)} onSave={async () => { await load(); toast(t('driverSaved')); }} />
    </AppShell>
  );
}
