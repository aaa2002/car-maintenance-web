'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, MetricSkeleton, PageHeader, SectionHeader, StatusPill, useToast } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import { createCar, getCars, getComplianceRecordsForCars, getDailySpendForMonth, getScheduledRepairs, getScheduledTrips, type Car, type ComplianceRecord, type Repair, type Trip } from '@/lib/database';
import { daysUntil, localDate, money, monthBounds, number } from '@/lib/format';

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
        eyebrow={t('fleetOverview')}
        title={displayName ? `${t('garage')}, ${displayName}` : t('garage')}
        subtitle={`${cars.length} ${t('vehicles').toLowerCase()} · ${attention.length ? `${attention.length} ${t('attentionItems').toLowerCase()}` : t('noAttention')}`}
        action={<button className="btn btn-primary" onClick={() => setAdding(true)}><i className="bi bi-plus-lg me-sm-2" /><span className="d-none d-sm-inline">{t('addVehicle')}</span></button>}
      />
      {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}

      <div className="row g-3 mb-4">
        {loading ? Array.from({ length: 4 }, (_, index) => <div className="col-6 col-xl-3" key={index}><MetricSkeleton /></div>) : <>
          <div className="col-6 col-xl-3"><div className="app-panel metric-panel"><span className="metric-label">{t('vehicles')}</span><strong className="metric-value">{cars.length}</strong></div></div>
          <div className="col-6 col-xl-3"><div className="app-panel metric-panel"><span className="metric-label">{t('attentionItems')}</span><strong className={`metric-value ${attention.length ? 'text-warning' : 'text-success'}`}>{attention.length}</strong></div></div>
          <div className="col-6 col-xl-3"><div className="app-panel metric-panel"><span className="metric-label">{t('healthyDocuments')}</span><strong className="metric-value">{healthyDocs}</strong></div></div>
          <div className="col-6 col-xl-3"><Link href="/spend" className="app-panel metric-panel d-flex text-decoration-none text-body"><span className="metric-label">{t('thisMonth')}</span><strong className="metric-value fs-4">{money(monthSpend, currency, language)}</strong></Link></div>
        </>}
      </div>

      <section className="mb-4">
        <SectionHeader title={t('needsAttention')} />
        {loading ? <ListSkeleton rows={3} /> : attention.length ? <div className="data-list">{attention.map((item) => (
          <Link href={item.href} key={item.key} className="data-row">
            <span className={`row-icon tone-${item.tone}`}><i className={`bi ${item.icon}`} /></span>
            <span className="data-row-main"><span className="data-row-title">{item.title}</span><span className="data-row-subtitle">{item.subtitle}</span></span>
            <StatusPill tone={item.tone}>{item.label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" />
          </Link>
        ))}</div> : <div className="app-panel"><div className="data-row"><span className="row-icon tone-success"><i className="bi bi-check-lg" /></span><span className="data-row-main"><span className="data-row-title">{t('noAttention')}</span><span className="data-row-subtitle">ITP, RCA and scheduled work are up to date.</span></span></div></div>}
      </section>

      <section>
        <SectionHeader title={t('vehicles')} />
        {loading ? <ListSkeleton rows={4} /> : cars.length ? <div className="data-list">{cars.map((car) => (
          <Link href={`/vehicles/${car.id}`} key={car.id} className="data-row">
            {car.photoUrl ? <img src={car.photoUrl} alt="" loading="lazy" decoding="async" className="vehicle-thumb" /> : <span className="vehicle-thumb vehicle-placeholder"><i className="bi bi-car-front fs-4" /></span>}
            <span className="data-row-main"><span className="data-row-title">{car.brand} {car.model}</span><span className="data-row-subtitle">{car.description || car.year}</span></span>
            <span className="text-tabular text-body-secondary small text-nowrap">{car.mileageKm === null ? '—' : `${number(car.mileageKm, language, 0)} km`}</span>
            {warnings.get(car.id) && <span className={`row-icon tone-${warnings.get(car.id)}`} title={warnings.get(car.id) === 'danger' ? t('expired') : t('expiresSoon')}><i className={`bi ${warnings.get(car.id) === 'danger' ? 'bi-exclamation-octagon' : 'bi-exclamation-triangle'}`} /></span>}
            <i className="bi bi-chevron-right text-body-secondary" />
          </Link>
        ))}</div> : <div className="app-panel"><Empty icon="bi-car-front" title={t('noVehicles')} text={t('noVehiclesHint')} action={<button className="btn btn-primary" onClick={() => setAdding(true)}>{t('addVehicle')}</button>} /></div>}
      </section>

      <VehicleForm show={adding} onClose={() => setAdding(false)} onSave={async (input) => { await createCar(input); await load(true); toast(t('vehicleSaved')); }} />
    </AppShell>
  );
}
