'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import { createCar, getCars, getComplianceRecordsForCars, getDailySpendForMonth, getScheduledRepairs, getScheduledTrips, type Car, type ComplianceRecord, type Repair, type Trip } from '@/lib/database';
import { countLabel, daysUntil, localDate, money, monthBounds, number } from '@/lib/format';

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
  const [monthSpend, setMonthSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      const loadedCars = await getCars();
      const bounds = monthBounds(0);
      const [loadedRepairs, loadedTrips, loadedDocs, spend] = await Promise.all([
        getScheduledRepairs(),
        getScheduledTrips(),
        getComplianceRecordsForCars(loadedCars.map((car) => car.id)),
        getDailySpendForMonth({ currency, monthStart: bounds.start, nextMonthStart: bounds.next }),
      ]);
      setCars(loadedCars); setRepairs(loadedRepairs); setTrips(loadedTrips); setDocs(loadedDocs);
      setMonthSpend(spend.reduce((sum, row) => sum + row.repairSpend + row.tripSpend, 0));
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [currency, user]);

  useEffect(() => { if (user) void load(); }, [load, user]);
  const carMap = useMemo(() => new Map(cars.map((car) => [car.id, car])), [cars]);

  const attention = useMemo(() => {
    const items: Attention[] = [];
    docs.forEach((doc) => {
      const days = daysUntil(doc.expiresDate);
      if (days > 7) return;
      const car = carMap.get(doc.carId);
      items.push({
        key: `doc-${doc.id}`,
        title: `${doc.kind.toUpperCase()} · ${car?.brand ?? ''} ${car?.model ?? ''}`,
        subtitle: localDate(doc.expiresDate, language), days,
        tone: days < 0 ? 'danger' : 'warning',
        icon: days < 0 ? 'bi-exclamation-octagon' : 'bi-exclamation-triangle',
        href: `/vehicles/${doc.carId}?document=${doc.kind}`,
        label: days < 0 ? t('expired') : t('expiresSoon'),
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
    return items.sort((a, b) => a.days - b.days).slice(0, 8);
  }, [carMap, docs, repairs, trips, language, t]);

  const warnings = useMemo(() => {
    const map = new Map<number, 'danger' | 'warning'>();
    docs.forEach((doc) => {
      const days = daysUntil(doc.expiresDate);
      if (days < 0) map.set(doc.carId, 'danger');
      else if (days <= 7 && map.get(doc.carId) !== 'danger') map.set(doc.carId, 'warning');
    });
    return map;
  }, [docs]);

  const displayName = user?.user_metadata.display_name as string | undefined;
  const healthyDocs = docs.filter((doc) => daysUntil(doc.expiresDate) > 7).length;

  return (
    <AppShell>
      <PageHeader
        title={displayName ? `${t('garage')}, ${displayName}` : t('garage')}
        subtitle={`${countLabel(cars.length, language, t, 'vehicleCount')} · ${attention.length ? countLabel(attention.length, language, t, 'attentionCount') : t('noAttention')}`}
        action={<button className="btn btn-primary btn-island" onClick={() => setAdding(true)} aria-label={t('addVehicle')}><span className="d-none d-sm-inline">{t('addVehicle')}</span><span className="btn-island-icon"><i className="bi bi-plus-lg" /></span></button>}
      />
      {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}

      {loading ? <SummarySkeleton /> : (
        <div className="summary-bento">
          <Link href="/spend" className="bento-tile bento-spend reveal" style={stagger(0)}>
            <span className="metric-label">{t('thisMonth')}</span>
            <strong className="metric-value">{money(monthSpend, currency, language)}</strong>
            <span className="bento-link">{t('spend')}<span className="btn-island-icon"><i className="bi bi-arrow-up-right" /></span></span>
          </Link>
          <div className="bento-tile reveal" style={stagger(1)}><span className="metric-label">{t('vehicles')}</span><strong className="metric-value">{cars.length}</strong></div>
          <div className="bento-tile reveal" style={stagger(2)}><span className="metric-label">{t('attentionItems')}</span><strong className={`metric-value ${attention.length ? 'text-warning' : ''}`}>{attention.length}</strong></div>
          <div className="bento-tile bento-wide reveal" style={stagger(3)}><span className="metric-label">{t('healthyDocuments')}</span><strong className="metric-value">{healthyDocs}</strong></div>
        </div>
      )}

      <section className="section-gap">
        <SectionHeader title={t('needsAttention')} />
        {loading ? <ListSkeleton rows={2} /> : attention.length ? <div className="data-list">{attention.map((item, index) => (
          <Link href={item.href} key={item.key} className="data-row reveal" style={stagger(index)}>
            <span className={`row-icon tone-${item.tone}`}><i className={`bi ${item.icon}`} /></span>
            <span className="data-row-main"><span className="data-row-title">{item.title}</span><span className="data-row-subtitle">{item.subtitle}</span></span>
            <StatusPill tone={item.tone}>{item.label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" />
          </Link>
        ))}</div> : <div className="app-panel"><div className="data-row"><span className="row-icon tone-success"><i className="bi bi-check-lg" /></span><span className="data-row-main"><span className="data-row-title">{t('noAttention')}</span><span className="data-row-subtitle">{t('allClearHint')}</span></span></div></div>}
      </section>

      <section>
        <SectionHeader title={t('vehicles')} />
        {loading ? <VehicleGridSkeleton /> : cars.length ? <div className="vehicle-grid">{cars.map((car, index) => {
          const warning = warnings.get(car.id);
          return (
            <Link href={`/vehicles/${car.id}`} key={car.id} className="vehicle-tile reveal" style={stagger(index)}>
              <span className="vehicle-tile-media">
                {car.photoUrl ? <img src={car.photoUrl} alt="" loading="lazy" decoding="async" /> : <span className="vehicle-plate" aria-hidden="true">{car.brand}</span>}
                {warning && <span className="vehicle-tile-flag"><StatusPill tone={warning}>{warning === 'danger' ? t('expired') : t('expiresSoon')}</StatusPill></span>}
              </span>
              <span className="vehicle-tile-body">
                <span className="min-w-0"><span className="vehicle-tile-title truncate">{car.brand} {car.model}</span><span className="vehicle-tile-meta truncate">{car.description || car.year}</span></span>
                {car.mileageKm !== null && <span className="vehicle-tile-km num">{number(car.mileageKm, language, 0)} km</span>}
              </span>
            </Link>
          );
        })}</div> : <div className="app-panel"><Empty icon="bi-car-front" title={t('noVehicles')} text={t('noVehiclesHint')} action={<button className="btn btn-primary" onClick={() => setAdding(true)}>{t('addVehicle')}</button>} /></div>}
      </section>

      <VehicleForm show={adding} onClose={() => setAdding(false)} onSave={async (input) => { await createCar(input); await load(true); toast(t('vehicleSaved')); }} />
    </AppShell>
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
