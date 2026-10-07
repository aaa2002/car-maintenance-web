'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, Modal, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { atVehicleLimit, getBillingOverview, planLabel, type BillingOverview } from '@/lib/billing';
import { VehicleForm } from '@/components/vehicle-form';
import { createCar, getCars, getComplianceRecordsForCars, getDailySpendForMonth, getDoneTripsSince, getFleetProfit, getFuelUse, getScheduledRepairs, getScheduledTrips, getServicePlans, latestDocuments, type Car, type CarProfit, type ComplianceRecord, type FuelUse, type Repair, type ServicePlan, type Trip } from '@/lib/database';
import { getDriverDocuments, getDrivers, type Driver, type DriverDocument } from '@/lib/drivers';
import { CAR_DOCUMENTS, carLabel, dailyKm, documentState, DRIVER_DOCUMENTS, estimatedMileage, fuelAlerts, RATE_WINDOW_DAYS, serviceDue } from '@/lib/fleet';
import { discountOpen, getFines, needsDriverNamed, type Fine } from '@/lib/fines';
import { addDays, countLabel, daysUntil, localDate, money, monthBounds, monthRange, number, today } from '@/lib/format';

type Attention = {
  key: string;
  title: string;
  subtitle: string;
  days: number;
  tone: 'danger' | 'warning' | 'brand';
  icon: string;
  href: string;
  label: string;
};

export default function GaragePage() {
  const { t, language, currency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [cars, setCars] = useState<Car[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [docs, setDocs] = useState<ComplianceRecord[]>([]);
  const [driverDocs, setDriverDocs] = useState<DriverDocument[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [fuel, setFuel] = useState<FuelUse[]>([]);
  const [profit, setProfit] = useState<{ current: CarProfit[]; previous: CarProfit[] }>({ current: [], previous: [] });
  const [monthSpend, setMonthSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [adding, setAdding] = useState(false);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      const loadedCars = await getCars();
      const bounds = monthBounds(0);
      const [loadedRepairs, loadedTrips, loadedDocs, spend, overview, loadedDriverDocs, loadedDrivers, loadedPlans, loadedRecent, loadedFines, loadedFuel] = await Promise.all([
        getScheduledRepairs(),
        getScheduledTrips(),
        getComplianceRecordsForCars(loadedCars.map((car) => car.id)),
        getDailySpendForMonth({ currency, monthStart: bounds.start, nextMonthStart: bounds.next }),
        getBillingOverview(),
        getDriverDocuments(),
        getDrivers(),
        getServicePlans(),
        getDoneTripsSince(addDays(today(), -RATE_WINDOW_DAYS)),
        getFines(),
        // Fuel use over the last four weeks against each car's own baseline.
        getFuelUse(addDays(today(), -27), today()),
      ]);
      const [thisMonth, lastMonth] = [monthRange(0, 'en'), monthRange(-1, 'en')];
      const [currentProfit, previousProfit] = loadedDrivers.length
        ? await Promise.all([getFleetProfit(thisMonth.from, thisMonth.to, currency), getFleetProfit(lastMonth.from, lastMonth.to, currency)])
        : [[], []];
      setProfit({ current: currentProfit, previous: previousProfit });
      setBilling(overview);
      setCars(loadedCars); setRepairs(loadedRepairs); setTrips(loadedTrips); setDocs(latestDocuments(loadedDocs, (doc) => doc.carId));
      setDriverDocs(latestDocuments(loadedDriverDocs, (doc) => doc.driverId)); setDrivers(loadedDrivers); setPlans(loadedPlans);
      setRecentTrips(loadedRecent); setFines(loadedFines); setFuel(loadedFuel);
      setMonthSpend(spend.reduce((sum, row) => sum + row.repairSpend + row.tripSpend, 0));
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [currency, user]);

  useEffect(() => { if (user) void load(); }, [load, user]);
  // At the plan's limit, explain and point to plans instead of opening a form that cannot be saved.
  const addVehicle = () => (billing && atVehicleLimit(billing) ? setLimitOpen(true) : setAdding(true));
  const carMap = useMemo(() => new Map(cars.map((car) => [car.id, car])), [cars]);

  const attention = useMemo(() => {
    const items: Attention[] = [];
    const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
    docs.forEach((doc) => {
      const state = documentState(doc.expiresDate);
      if (state === 'valid') return;
      const car = carMap.get(doc.carId);
      items.push({
        key: `doc-${doc.id}`,
        title: `${t(CAR_DOCUMENTS[doc.kind].label)} · ${car ? carLabel(car) : ''}`,
        subtitle: localDate(doc.expiresDate, language), days: daysUntil(doc.expiresDate),
        tone: state === 'expired' ? 'danger' : 'warning',
        icon: state === 'expired' ? 'bi-exclamation-octagon' : 'bi-exclamation-triangle',
        href: `/vehicles/${doc.carId}?document=${doc.kind}`,
        label: state === 'expired' ? t('expired') : t('expiresSoon'),
      });
    });
    driverDocs.forEach((doc) => {
      const state = documentState(doc.expiresDate);
      const driver = driverMap.get(doc.driverId);
      if (state === 'valid' || !driver?.active) return;
      items.push({
        key: `driver-doc-${doc.id}`, title: `${t(DRIVER_DOCUMENTS[doc.kind].label)} · ${driver.fullName}`, subtitle: localDate(doc.expiresDate, language), days: daysUntil(doc.expiresDate),
        tone: state === 'expired' ? 'danger' : 'warning', icon: 'bi-person-exclamation', href: `/drivers/${doc.driverId}`, label: state === 'expired' ? t('expired') : t('expiresSoon'),
      });
    });
    fines.forEach((fine) => {
      const car = carMap.get(fine.carId);
      const who = fine.driverId ? driverMap.get(fine.driverId)?.fullName : null;
      const subtitle = [car ? carLabel(car) : null, who, money(fine.amount, fine.currency, language)].filter(Boolean).join(' · ');
      if (discountOpen(fine) && daysUntil(fine.discountUntil!) <= 5) {
        const days = daysUntil(fine.discountUntil!);
        items.push({ key: `fine-pay-${fine.id}`, title: t('halfPriceEnds'), subtitle, days, tone: days <= 1 ? 'danger' : 'warning', icon: 'bi-receipt', href: '/fines', label: days === 0 ? t('halfPriceToday') : t('halfPriceDays').replace('{n}', String(days)) });
      }
      if (needsDriverNamed(fine)) items.push({ key: `fine-name-${fine.id}`, title: t('nameDriverToPolice'), subtitle, days: daysUntil(fine.receivedOn) + 15, tone: 'warning', icon: 'bi-person-vcard', href: '/fines', label: t('nameDriver') });
    });
    plans.forEach((plan) => {
      const car = carMap.get(plan.carId);
      if (!car || car.locked) return;
      const rate = dailyKm(recentTrips, car.id);
      const due = serviceDue(plan, estimatedMileage(car, rate), rate);
      if (due.state !== 'overdue' && due.state !== 'soon') return;
      const detail = due.kmLeft !== null ? (due.kmLeft < 0 ? t('kmOverdue').replace('{n}', number(-due.kmLeft, language, 0)) : t('kmLeft').replace('{n}', number(due.kmLeft, language, 0))) : due.dueDate ? localDate(due.dueDate, language) : '';
      items.push({ key: `plan-${plan.id}`, title: `${plan.title} · ${carLabel(car)}`, subtitle: detail, days: due.dueDate ? daysUntil(due.dueDate) : 0, tone: due.state === 'overdue' ? 'danger' : 'warning', icon: 'bi-wrench-adjustable', href: `/vehicles/${car.id}`, label: t(`service_${due.state}`) });
    });
    fuelAlerts(fuel).forEach((alert) => {
      const car = carMap.get(alert.carId);
      const driver = alert.driverId ? driverMap.get(alert.driverId) : undefined;
      items.push({
        key: `fuel-${alert.carId}-${alert.driverId ?? 0}`, title: `${t('fuelAboveUsual')} · ${driver?.fullName ?? (car ? carLabel(car) : '')}`,
        subtitle: t('fuelAlertDetail').replace('{value}', number(alert.consumption!, language)).replace('{baseline}', number(alert.baseline!, language)).replace('{car}', car ? `${car.brand} ${car.model}` : ''),
        days: 0, tone: 'warning', icon: 'bi-fuel-pump', href: driver ? `/drivers/${driver.id}` : `/vehicles/${alert.carId}`, label: `+${number(alert.deviation * 100, language, 0)}%`,
      });
    });
    repairs.forEach((repair) => {
      const car = carMap.get(repair.carId);
      items.push({ key: `repair-${repair.id}`, title: repair.title, subtitle: `${car?.brand ?? ''} ${car?.model ?? ''} · ${localDate(repair.date, language)}`, days: daysUntil(repair.date), tone: 'brand', icon: 'bi-tools', href: `/vehicles/${repair.carId}?repair=${repair.id}`, label: t('scheduledRepair') });
    });
    trips.forEach((trip) => {
      const car = carMap.get(trip.carId);
      items.push({ key: `trip-${trip.id}`, title: `${number(trip.distance, language)} km`, subtitle: `${car?.brand ?? ''} ${car?.model ?? ''} · ${localDate(trip.date, language)}`, days: daysUntil(trip.date), tone: 'brand', icon: 'bi-signpost-split', href: `/vehicles/${trip.carId}?trip=${trip.id}`, label: t('scheduledTrip') });
    });
    return items.sort((a, b) => a.days - b.days);
  }, [carMap, docs, driverDocs, drivers, fines, plans, recentTrips, fuel, repairs, trips, language, t]);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const visibleAttention = showAllAttention ? attention : attention.slice(0, 8);

  const warnings = useMemo(() => {
    const map = new Map<number, 'danger' | 'warning'>();
    docs.forEach((doc) => {
      const state = documentState(doc.expiresDate);
      if (state === 'expired') map.set(doc.carId, 'danger');
      else if (state === 'soon' && map.get(doc.carId) !== 'danger') map.set(doc.carId, 'warning');
    });
    return map;
  }, [docs]);

  const displayName = user?.user_metadata.display_name as string | undefined;
  const healthyDocs = docs.filter((doc) => documentState(doc.expiresDate) === 'valid').length;

  return (
    <AppShell>
      <PageHeader
        title={displayName ? `${t('garage')}, ${displayName}` : t('garage')}
        subtitle={`${countLabel(cars.length, language, t, 'vehicleCount')} · ${attention.length ? countLabel(attention.length, language, t, 'attentionCount') : t('noAttention')}`}
        action={<button className="btn btn-primary btn-island" onClick={() => addVehicle()} aria-label={t('addVehicle')}><span className="d-none d-sm-inline">{t('addVehicle')}</span><span className="btn-island-icon"><i className="bi bi-plus-lg" /></span></button>}
      />
      {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}

      {loading ? <SummarySkeleton /> : (
        <div className="summary-bento">
          <Link href="/spend" className="bento-tile bento-spend reveal" style={stagger(0)}>
            <span className="metric-label">{t('spentThisMonth')}</span>
            <strong className="metric-value">{money(monthSpend, currency, language)}</strong>
            <span className="bento-link">{t('spend')}<span className="btn-island-icon"><i className="bi bi-arrow-up-right" /></span></span>
          </Link>
          <div className="bento-tile reveal" style={stagger(1)}><span className="metric-label">{t('vehicles')}</span><strong className="metric-value">{cars.length}</strong></div>
          <div className="bento-tile reveal" style={stagger(2)}><span className="metric-label">{t('attentionItems')}</span><strong className={`metric-value ${attention.length ? 'text-warning' : ''}`}>{attention.length}</strong></div>
          <div className="bento-tile bento-wide reveal" style={stagger(3)}><span className="metric-label">{t('healthyDocuments')}</span><strong className="metric-value">{healthyDocs}</strong></div>
          {(profit.current.length > 0 || profit.previous.length > 0) && <ProfitTile current={profit.current} previous={profit.previous} carMap={carMap} />}
        </div>
      )}

      <section className="section-gap">
        <SectionHeader title={t('needsAttention')} />
        {loading ? <ListSkeleton rows={2} /> : attention.length ? <><div className="data-list">{visibleAttention.map((item, index) => (
          <Link href={item.href} key={item.key} className="data-row reveal" style={stagger(index)}>
            <span className={`row-icon tone-${item.tone}`}><i className={`bi ${item.icon}`} /></span>
            <span className="data-row-main"><span className="data-row-title">{item.title}</span><span className="data-row-subtitle">{item.subtitle}</span></span>
            <StatusPill tone={item.tone}>{item.label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" />
          </Link>
        ))}</div>{attention.length > 8 && <button className="btn btn-sm btn-outline-secondary mt-3" onClick={() => setShowAllAttention((value) => !value)}>{showAllAttention ? t('showLess') : t('showAllCount').replace('{n}', String(attention.length))}</button>}</> : <div className="app-panel"><div className="data-row"><span className="row-icon tone-success"><i className="bi bi-check-lg" /></span><span className="data-row-main"><span className="data-row-title">{t('noAttention')}</span><span className="data-row-subtitle">{t('allClearHint')}</span></span></div></div>}
      </section>

      <section>
        <SectionHeader title={t('vehicles')} />
        {loading ? <VehicleGridSkeleton /> : cars.length ? <div className="vehicle-grid">{cars.map((car, index) => {
          const warning = warnings.get(car.id);
          return (
            <Link href={`/vehicles/${car.id}`} key={car.id} className="vehicle-tile reveal" style={stagger(index)}>
              <span className="vehicle-tile-media">
                {car.photoUrl ? <img src={car.photoUrl} alt="" loading="lazy" decoding="async" /> : <span className="vehicle-plate" aria-hidden="true">{car.brand}</span>}
                {car.locked
                  ? <span className="vehicle-tile-flag"><StatusPill tone="neutral"><i className="bi bi-lock me-1" aria-hidden="true" />{t('readOnly')}</StatusPill></span>
                  : warning && <span className="vehicle-tile-flag"><StatusPill tone={warning}>{warning === 'danger' ? t('expired') : t('expiresSoon')}</StatusPill></span>}
              </span>
              <span className="vehicle-tile-body">
                <span className="min-w-0"><span className="vehicle-tile-title truncate">{car.brand} {car.model}</span><span className="vehicle-tile-meta truncate">{car.plateNumber || car.description || car.year}</span></span>
                {car.mileageKm !== null && <span className="vehicle-tile-km num">{number(car.mileageKm, language, 0)} km</span>}
              </span>
            </Link>
          );
        })}</div> : <div className="app-panel"><Empty icon="bi-car-front" title={t('noVehicles')} text={t('noVehiclesHint')} action={<button className="btn btn-primary" onClick={() => addVehicle()}>{t('addVehicle')}</button>} /></div>}
      </section>

      <Modal title={t('vehicleLimitTitle')} show={limitOpen} onClose={() => setLimitOpen(false)} variant="modal">
        <div className="modal-body"><p className="mb-0 text-body-secondary">{billing && t('vehicleLimitHint').replace('{plan}', planLabel(billing.planId, t)).replace('{limit}', String(billing.vehicleLimit))}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={() => setLimitOpen(false)}>{t('cancel')}</button>
          <Link href="/settings#plan" className="btn btn-primary" onClick={() => setLimitOpen(false)}>{t('seePlans')}</Link>
        </div>
      </Modal>

      <VehicleForm show={adding} onClose={() => setAdding(false)} onSave={async (input) => { await createCar(input); await load(true); toast(t('vehicleSaved')); }} />
    </AppShell>
  );
}

/** Month-to-date fleet profit against last month's total, with the best and weakest vehicle: a goal to beat. */
function ProfitTile({ current, previous, carMap }: { current: CarProfit[]; previous: CarProfit[]; carMap: Map<number, Car> }) {
  const { t, language, currency } = useSettings();
  const sum = (rows: CarProfit[], key: 'income' | 'repairCost' | 'fineCost' | 'profit') => rows.reduce((total, row) => total + row[key], 0);
  const profit = sum(current, 'profit'); const income = sum(current, 'income'); const costs = sum(current, 'repairCost') + sum(current, 'fineCost');
  const target = sum(previous, 'profit');
  const progress = target > 0 ? Math.max(0, profit / target) : null;
  const lastMonth = monthRange(-1, language).label;
  const ranked = current.filter((row) => row.carId !== null && carMap.has(row.carId)).sort((a, b) => b.profit - a.profit);
  const best = ranked.length > 1 ? ranked[0] : null;
  const weakest = ranked.length > 1 ? ranked.at(-1)! : null;
  const signed = (value: number) => `${value < 0 ? '-' : '+'}${money(Math.abs(value), currency, language)}`;
  const carName = (row: CarProfit) => { const car = carMap.get(row.carId!)!; return `${car.brand} ${car.model}`; };

  return (
    <div className="bento-tile bento-profit reveal" style={stagger(4)}>
      <div className="profit-main">
        <span className="metric-label">{t('profitThisMonth')}</span>
        <strong className={`metric-value ${profit < 0 ? 'text-danger' : ''}`}>{profit < 0 ? '-' : ''}{money(Math.abs(profit), currency, language)}</strong>
        {progress !== null ? <>
          <div className="profit-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(progress, 1) * 100)} aria-label={t('profitVsLastMonth')}><span style={{ width: `${Math.min(progress, 1) * 100}%` }} className={progress >= 1 ? 'is-ahead' : ''} /></div>
          <span className="small text-body-secondary">{progress >= 1
            ? t('profitAhead').replace('{month}', lastMonth).replace('{amount}', money(profit - target, currency, language))
            : t('profitProgress').replace('{n}', number(progress * 100, language, 0)).replace('{month}', lastMonth).replace('{amount}', money(target, currency, language))}</span>
        </> : <span className="small text-body-secondary">{t('profitHint')}</span>}
      </div>
      <div className="profit-breakdown">
        <div className="profit-line"><span className="metric-label">{t('profitIncome')}</span><strong className="num">{money(income, currency, language)}</strong></div>
        <div className="profit-line"><span className="metric-label">{t('profitCosts')}</span><strong className="num">{costs ? `-${money(costs, currency, language)}` : money(0, currency, language)}</strong></div>
        {best && <Link href={`/vehicles/${best.carId}`} className="profit-car"><i className="bi bi-trophy" aria-hidden="true" /><span className="truncate">{t('profitBest')}: {carName(best)}</span><strong className="num text-success">{signed(best.profit)}</strong></Link>}
        {weakest && weakest !== best && <Link href={`/vehicles/${weakest.carId}`} className="profit-car"><i className={`bi ${weakest.profit < 0 ? 'bi-graph-down-arrow' : 'bi-arrow-down-right'}`} aria-hidden="true" /><span className="truncate">{t(weakest.profit < 0 ? 'profitLosing' : 'profitLowest')}: {carName(weakest)}</span><strong className={`num ${weakest.profit < 0 ? 'text-danger' : ''}`}>{signed(weakest.profit)}</strong></Link>}
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="summary-bento" aria-hidden="true">
      <div className="bento-tile bento-spend-skeleton"><div className="skeleton" style={{ width: 90, height: 10 }} /><div className="skeleton" style={{ width: '62%', height: 40 }} /></div>
      {['', '', 'bento-wide'].map((extra, index) => <div className={`bento-tile ${extra}`} key={index}><div className="skeleton" style={{ width: 84, height: 10 }} /><div className="skeleton" style={{ width: 36, height: 28 }} /></div>)}
    </div>
  );
}

function VehicleGridSkeleton() {
  return (
    <div className="vehicle-grid" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div className="vehicle-tile" key={index}>
          <div className="vehicle-tile-media skeleton" style={{ borderRadius: 0 }} />
          <div className="vehicle-tile-body"><div className="flex-grow-1"><div className="skeleton mb-2" style={{ width: '58%', height: 12 }} /><div className="skeleton" style={{ width: '34%', height: 9 }} /></div></div>
        </div>
      ))}
    </div>
  );
}
