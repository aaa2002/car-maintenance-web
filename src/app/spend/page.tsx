'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { ErrorAlert, PageHeader, SectionHeader, StatusPill } from '@/components/ui';
import { getCars, getDailySpendForMonth, type Car, type DailySpend } from '@/lib/database';
import { money, monthBounds } from '@/lib/format';

type Filter = 'total' | 'repairs' | 'trips';
const amountFor = (row: DailySpend, filter: Filter) => (filter !== 'trips' ? row.repairSpend : 0) + (filter !== 'repairs' ? row.tripSpend : 0);

export default function SpendPage() {
  const { t, currency, language } = useSettings(); const { user } = useAuth();
  const [cars, setCars] = useState<Car[]>([]); const [rows, setRows] = useState<DailySpend[]>([]); const [previousRows, setPreviousRows] = useState<DailySpend[]>([]);
  const [carId, setCarId] = useState<number | undefined>(); const [monthOffset, setMonthOffset] = useState(0); const [filter, setFilter] = useState<Filter>('total');
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<unknown>(); const loaded = useRef(false);
  const bounds = useMemo(() => monthBounds(monthOffset), [monthOffset]); const previousBounds = useMemo(() => monthBounds(monthOffset - 1), [monthOffset]);

  const load = useCallback(async () => {
    if (!user) return;
    if (loaded.current) setRefreshing(true); else setLoading(true);
    setError(undefined);
    try {
      const [loadedCars, spend, previousSpend] = await Promise.all([
        getCars(),
        getDailySpendForMonth({ carId, currency, monthStart: bounds.start, nextMonthStart: bounds.next }),
        getDailySpendForMonth({ carId, currency, monthStart: previousBounds.start, nextMonthStart: previousBounds.next }),
      ]);
      setCars(loadedCars); setRows(spend); setPreviousRows(previousSpend); loaded.current = true;
    } catch (caught) { setError(caught); }
    finally { setLoading(false); setRefreshing(false); }
  }, [carId, currency, bounds.start, bounds.next, previousBounds.start, previousBounds.next, user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search); const vehicle = Number(params.get('vehicle')); const category = params.get('category'); const month = Number(params.get('month'));
    if (vehicle > 0) setCarId(vehicle); if (category === 'repairs' || category === 'trips') setFilter(category); if (Number.isInteger(month) && month <= 0) setMonthOffset(month);
  }, []);
  useEffect(() => { if (user) void load(); }, [load, user]);
  useEffect(() => {
    const params = new URLSearchParams(); if (carId) params.set('vehicle', String(carId)); if (filter !== 'total') params.set('category', filter); if (monthOffset) params.set('month', String(monthOffset));
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }, [carId, filter, monthOffset]);

  const chartRows = useMemo(() => {
    const map = new Map(rows.map((row) => [row.date, row])); const values: DailySpend[] = [];
    const date = new Date(`${bounds.start}T12:00:00`); const end = new Date(`${bounds.next}T12:00:00`);
    while (date < end) { const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; values.push(map.get(key) ?? { date: key, repairSpend: 0, tripSpend: 0 }); date.setDate(date.getDate() + 1); }
    return values;
  }, [rows, bounds.start, bounds.next]);

  const total = rows.reduce((sum, row) => sum + amountFor(row, filter), 0); const previousTotal = previousRows.reduce((sum, row) => sum + amountFor(row, filter), 0);
  const change = previousTotal > 0 ? (total - previousTotal) / previousTotal * 100 : null;
  const max = Math.max(1, ...chartRows.map((row) => amountFor(row, filter)));
  const formatter = new Intl.DateTimeFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { month: 'long', year: 'numeric' });
  const monthLabel = formatter.format(new Date(`${bounds.start}T12:00:00`));

  return <AppShell>
    <PageHeader eyebrow={t('overview')} title={t('spend')} subtitle={monthLabel} action={<div className="d-flex align-items-center gap-2">{refreshing && <span className="spinner-border spinner-border-sm text-body-secondary" role="status" aria-label={t('loading')} />}<div className="segmented"><button aria-label={t('previous')} onClick={() => setMonthOffset((value) => value - 1)}><i className="bi bi-chevron-left" /></button><button className={!monthOffset ? 'active' : ''} onClick={() => setMonthOffset(0)}>{t('thisMonth')}</button><button aria-label={t('next')} disabled={monthOffset >= 0} onClick={() => setMonthOffset((value) => value + 1)}><i className="bi bi-chevron-right" /></button></div></div>} />
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}

    <div className="app-panel app-panel-body mb-4"><div className="row g-3 align-items-end">
      <div className="col-md-6"><label className="form-label" htmlFor="spend-vehicle">{t('vehicle')}</label><select id="spend-vehicle" className="form-select" disabled={loading} value={carId ?? ''} onChange={(event) => setCarId(event.target.value ? Number(event.target.value) : undefined)}><option value="">{t('allVehicles')}</option>{cars.map((car) => <option value={car.id} key={car.id}>{car.brand} {car.model}</option>)}</select></div>
      <div className="col-md-6"><span className="form-label d-block">{t('spend')}</span><div className="segmented w-100">{(['total', 'repairs', 'trips'] as Filter[]).map((value) => <button key={value} className={`flex-fill ${filter === value ? 'active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(value === 'repairs' ? 'repairs' : value === 'trips' ? 'trips' : 'total')}</button>)}</div></div>
    </div></div>

    <div className="row g-3 mb-4"><div className="col-md-8"><div className="app-panel metric-panel h-100"><span className="metric-label">{t('total')} · {monthLabel}</span>{loading ? <div className="skeleton" style={{ width: 220, height: 34 }} /> : <strong className="metric-value">{money(total, currency, language)}</strong>}{change !== null && <div className="metric-note"><StatusPill tone={change <= 0 ? 'success' : 'warning'}>{Math.abs(change).toFixed(0)}% {change <= 0 ? t('lower') : t('higher')}</StatusPill><span className="ms-2">{t('thanPrevious')}</span></div>}</div></div><div className="col-md-4"><div className="app-panel metric-panel h-100"><span className="metric-label">{t('previousMonth')}</span><strong className="fs-5 text-tabular">{loading ? '—' : money(previousTotal, currency, language)}</strong></div></div></div>

    <section><SectionHeader title={`${t('spend')} · ${monthLabel}`} />
      <div className="app-panel app-panel-body">{loading ? <div className="skeleton" style={{ height: 275 }} /> : total > 0 ? <>
        <div className="chart-grid" role="group" aria-label={`${t('spend')}: ${money(total, currency, language)}`}>{chartRows.map((row) => { const repair = filter === 'trips' ? 0 : row.repairSpend; const trip = filter === 'repairs' ? 0 : row.tripSpend; const dayTotal = repair + trip; return <div className="chart-day" key={row.date} tabIndex={dayTotal ? 0 : -1} aria-label={`${row.date}: ${money(dayTotal, currency, language)}`} title={`${row.date}: ${money(dayTotal, currency, language)}`}><div className="chart-bars"><div className="chart-bar-repairs rounded-top" style={{ height: `${repair / max * 215}px` }} /><div className="chart-bar-trips rounded-top" style={{ height: `${trip / max * 215}px` }} /></div><small className="text-body-secondary">{Number(row.date.slice(-2))}</small></div>; })}</div>
        <div className="d-flex gap-4 justify-content-center mt-3 small">{filter !== 'trips' && <span><span className="d-inline-block rounded me-2" style={{ width: 10, height: 10, background: 'var(--app-brand)' }} />{t('repairsLegend')}</span>}{filter !== 'repairs' && <span><span className="d-inline-block rounded me-2" style={{ width: 10, height: 10, background: 'var(--app-info)' }} />{t('tripsLegend')}</span>}</div>
        <details className="mt-4"><summary className="text-body-secondary">View daily totals</summary><div className="table-responsive mt-3"><table className="table table-sm align-middle"><thead><tr><th>{t('date')}</th><th className="text-end">{t('repairs')}</th><th className="text-end">{t('trips')}</th><th className="text-end">{t('total')}</th></tr></thead><tbody>{chartRows.filter((row) => amountFor(row, filter) > 0).map((row) => <tr key={row.date}><td>{row.date}</td><td className="text-end">{money(row.repairSpend, currency, language)}</td><td className="text-end">{money(row.tripSpend, currency, language)}</td><td className="text-end fw-semibold">{money(row.repairSpend + row.tripSpend, currency, language)}</td></tr>)}</tbody></table></div></details>
      </> : <div className="empty-state"><span className="empty-icon"><i className="bi bi-bar-chart" /></span><h3>{t('noSpend')}</h3></div>}</div>
    </section>
  </AppShell>;
}
