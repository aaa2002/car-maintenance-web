'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { ComplianceForm, RepairForm, TripForm } from '@/components/maintenance-forms';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, Empty, ErrorAlert, ListSkeleton, MetricSkeleton, Modal, PageHeader, SectionHeader, StatusPill, useToast } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import {
  deleteCar,
  deleteComplianceRecord,
  deleteRepair,
  deleteTrip,
  getCar,
  getComplianceRecordsForCar,
  getRepairsForCar,
  getTripsForCar,
  updateCar,
  updateCarMileage,
  type Car,
  type ComplianceKind,
  type ComplianceRecord,
  type Repair,
  type Trip,
} from '@/lib/database';
import { daysUntil, errorMessage, localDate, money, number } from '@/lib/format';
import { CAR_DOCUMENT_BUCKET, CAR_PHOTO_BUCKET, removeObject } from '@/lib/storage';

type ActivityFilter = 'all' | 'repairs' | 'trips';
type Activity = { key: string; kind: 'repair'; date: string; status: 'done' | 'scheduled'; repair: Repair } | { key: string; kind: 'trip'; date: string; status: 'done' | 'scheduled'; trip: Trip };

export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const carId = Number(id);
  const router = useRouter();
  const { t, language, currency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [car, setCar] = useState<Car | null>(null);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [docs, setDocs] = useState<ComplianceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [editVehicle, setEditVehicle] = useState(false);
  const [mileageOpen, setMileageOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [tripOpen, setTripOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [docKind, setDocKind] = useState<ComplianceKind | null>(null);
  const openedQuery = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!user || !Number.isInteger(carId)) return;
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      const [loadedCar, loadedRepairs, loadedTrips, loadedDocs] = await Promise.all([
        getCar(carId), getRepairsForCar(carId), getTripsForCar(carId), getComplianceRecordsForCar(carId),
      ]);
      setCar(loadedCar); setRepairs(loadedRepairs); setTrips(loadedTrips); setDocs(loadedDocs);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [carId, user]);

  useEffect(() => { if (user) void load(); }, [load, user]);
  useEffect(() => {
    if (loading || openedQuery.current) return;
    openedQuery.current = true;
    const query = new URLSearchParams(location.search);
    const repairId = Number(query.get('repair')); const tripId = Number(query.get('trip')); const kind = query.get('document');
    if (repairId) { const item = repairs.find((value) => value.id === repairId); if (item) { setEditingRepair(item); setRepairOpen(true); } }
    else if (tripId) { const item = trips.find((value) => value.id === tripId); if (item) { setEditingTrip(item); setTripOpen(true); } }
    else if (kind === 'itp' || kind === 'rca') setDocKind(kind);
  }, [loading, repairs, trips]);

  const metrics = useMemo(() => {
    const totalCost = repairs.filter((item) => item.status === 'done' && item.currency === currency).reduce((sum, item) => sum + item.price, 0) + trips.filter((item) => item.status === 'done' && item.currency === currency).reduce((sum, item) => sum + (item.price ?? 0), 0);
    const totalDistance = trips.filter((item) => item.status === 'done').reduce((sum, item) => sum + item.distance, 0);
    const fuel = trips.filter((item) => item.status === 'done').reduce((sum, item) => sum + item.fuelUsed, 0);
    return { totalCost, totalDistance, average: totalDistance > 0 ? fuel / totalDistance * 100 : 0 };
  }, [repairs, trips, currency]);

  const activity = useMemo(() => {
    const values: Activity[] = [
      ...repairs.map((repair): Activity => ({ key: `repair-${repair.id}`, kind: 'repair', date: repair.date, status: repair.status, repair })),
      ...trips.map((trip): Activity => ({ key: `trip-${trip.id}`, kind: 'trip', date: trip.date, status: trip.status, trip })),
    ];
    return values.filter((item) => activityFilter === 'all' || (activityFilter === 'repairs' ? item.kind === 'repair' : item.kind === 'trip')).sort((a, b) => a.status === b.status ? b.date.localeCompare(a.date) : a.status === 'scheduled' ? -1 : 1);
  }, [repairs, trips, activityFilter]);

  const documentFor = (kind: ComplianceKind) => docs.find((item) => item.kind === kind) ?? null;
  if (!Number.isInteger(carId)) return <AppShell><ErrorAlert error={new Error('Invalid vehicle ID.')} /></AppShell>;

  return <AppShell>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}
    {loading ? <VehicleSkeleton /> : !car ? <div className="app-panel"><Empty icon="bi-car-front" title="Vehicle not found" action={<Link href="/" className="btn btn-primary">{t('garage')}</Link>} /></div> : <>
      <PageHeader
        eyebrow={<Link href="/" className="text-decoration-none"><i className="bi bi-arrow-left me-1" />{t('garage')}</Link>}
        title={`${car.brand} ${car.model}`}
        subtitle={`${car.year}${car.description ? ` · ${car.description}` : ''}`}
        action={<button className="btn btn-outline-secondary" onClick={() => setEditVehicle(true)}><i className="bi bi-pencil me-sm-2" /><span className="d-none d-sm-inline">{t('edit')}</span></button>}
      />

      {car.photoUrl && <div className="app-panel mb-4"><img src={car.photoUrl} alt={`${car.brand} ${car.model}`} className="vehicle-photo" /></div>}

      <div className="row g-3 mb-4">
        <div className="col-lg-5"><button className="app-panel metric-panel w-100 text-start h-100" onClick={() => setMileageOpen(true)}><span className="d-flex justify-content-between"><span className="metric-label">{t('currentMileage')}</span><i className="bi bi-pencil text-body-secondary" /></span><strong className="metric-value">{car.mileageKm === null ? '—' : `${number(car.mileageKm, language, 0)} km`}</strong></button></div>
        <div className="col-lg-7"><div className="app-panel app-panel-body h-100"><SectionHeader title={t('quickActions')} /><div className="quick-actions"><button className="quick-action" onClick={() => { setEditingRepair(null); setRepairOpen(true); }}><span className="row-icon tone-brand"><i className="bi bi-tools" /></span>{t('add')} {t('repair').toLowerCase()}</button><button className="quick-action" onClick={() => { setEditingTrip(null); setTripOpen(true); }}><span className="row-icon tone-info"><i className="bi bi-signpost-split" /></span>{t('add')} {t('trip').toLowerCase()}</button><button className="quick-action" onClick={() => setMileageOpen(true)}><span className="row-icon"><i className="bi bi-speedometer2" /></span>{t('currentMileage')}</button></div></div></div>
      </div>

      <section className="mb-4">
        <SectionHeader title={t('documents')} />
        <div className="row g-3">{(['itp', 'rca'] as const).map((kind) => {
          const doc = documentFor(kind); const days = doc ? daysUntil(doc.expiresDate) : null;
          const tone = days === null ? 'neutral' : days < 0 ? 'danger' : days <= 7 ? 'warning' : 'success';
          const label = doc ? (days! < 0 ? t('expired') : days! <= 7 ? t('expiresSoon') : t('valid')) : t('noDocument');
          return <div className="col-md-6" key={kind}><button className="app-panel data-row w-100 text-start" onClick={() => setDocKind(kind)}><span className={`row-icon tone-${tone}`}><i className={`bi ${kind === 'itp' ? 'bi-clipboard2-check' : 'bi-shield-check'}`} /></span><span className="data-row-main"><span className="data-row-title">{kind.toUpperCase()}</span><span className="data-row-subtitle">{doc ? localDate(doc.expiresDate, language) : t('addDocument')}</span></span><StatusPill tone={tone}>{label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" /></button></div>;
        })}</div>
      </section>

      <section className="mb-4">
        <SectionHeader title={t('overview')} />
        <div className="row g-3">
          <Metric label={t('repairs')} value={String(repairs.length)} />
          <Metric label={t('trips')} value={String(trips.length)} />
          <Metric label={t('totalCost')} value={money(metrics.totalCost, currency, language)} />
          <Metric label={t('loggedDistance')} value={`${number(metrics.totalDistance, language, 0)} km`} />
          <Metric label={t('avgConsumption')} value={`${number(metrics.average, language)} L/100 km`} />
        </div>
      </section>

      <section className="mb-4">
        <SectionHeader title={t('activity')} action={<div className="segmented">{(['all', 'repairs', 'trips'] as const).map((value) => <button key={value} className={activityFilter === value ? 'active' : ''} aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)}>{value === 'all' ? t('allActivity') : t(value)}</button>)}</div>} />
        {activity.length ? <div className="data-list">{activity.map((item) => item.kind === 'repair' ? <RepairActivity key={item.key} repair={item.repair} language={language} onEdit={() => { setEditingRepair(item.repair); setRepairOpen(true); }} onDelete={async () => { await deleteRepair(item.repair.id); await load(true); toast(t('deletedItem')); }} /> : <TripActivity key={item.key} trip={item.trip} language={language} onEdit={() => { setEditingTrip(item.trip); setTripOpen(true); }} onDelete={async () => { await deleteTrip(item.trip.id); await load(true); toast(t('deletedItem')); }} />)}</div> : <div className="app-panel"><Empty icon="bi-activity" title={activityFilter === 'repairs' ? t('noRepairs') : activityFilter === 'trips' ? t('noTrips') : t('noActivity')} /></div>}
      </section>

      <div className="border-top pt-4"><ConfirmButton title={t('deleteVehicle')} message={t('confirmDeleteVehicle')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { await deleteCar(car.id); router.push('/'); }}>{t('deleteVehicle')}</ConfirmButton></div>

      <VehicleForm show={editVehicle} car={car} onClose={() => setEditVehicle(false)} onSave={async (input) => { const oldPhoto = car.photoPath; await updateCar(car.id, input); if (oldPhoto && oldPhoto !== input.photoPath) await removeObject(CAR_PHOTO_BUCKET, oldPhoto); await load(true); toast(t('vehicleSaved')); }} />
      <MileageModal show={mileageOpen} initial={car.mileageKm} onClose={() => setMileageOpen(false)} onSave={async (value) => { await updateCarMileage(car.id, value); await load(true); toast(t('mileageSaved')); }} />
      <RepairForm show={repairOpen} carId={car.id} repair={editingRepair} defaultMileage={car.mileageKm} onClose={() => setRepairOpen(false)} onSaved={async () => { await load(true); toast(t('repairSaved')); }} />
      <TripForm show={tripOpen} carId={car.id} trip={editingTrip} onClose={() => setTripOpen(false)} onSaved={async () => { await load(true); toast(t('tripSaved')); }} />
      {docKind && <ComplianceForm show carId={car.id} kind={docKind} record={documentFor(docKind)} onClose={() => setDocKind(null)} onSaved={async () => { await load(true); toast(t('documentSaved')); }} onDelete={async (record) => { await deleteComplianceRecord(record.id); await removeObject(CAR_DOCUMENT_BUCKET, record.attachmentPath); await load(true); setDocKind(null); toast(t('deletedItem')); }} />}
    </>}
  </AppShell>;
}

function VehicleSkeleton() {
  return <><div className="mb-4"><div className="skeleton mb-2" style={{ width: 80, height: 10 }} /><div className="skeleton mb-2" style={{ width: 280, height: 34 }} /><div className="skeleton" style={{ width: 180, height: 12 }} /></div><div className="row g-3 mb-4"><div className="col-lg-5"><MetricSkeleton /></div><div className="col-lg-7"><MetricSkeleton /></div></div><ListSkeleton rows={4} /></>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="col-6 col-xl"><div className="app-panel metric-panel"><span className="metric-label">{label}</span><strong className="fs-6 text-tabular">{value}</strong></div></div>;
}

function RepairActivity({ repair, language, onEdit, onDelete }: { repair: Repair; language: 'en' | 'ro'; onEdit: () => void; onDelete: () => Promise<void> }) {
  const { t } = useSettings();
  return <div className="data-row p-0"><button className="data-row-action px-3 py-2" onClick={onEdit}><span className={`row-icon tone-${repair.status === 'scheduled' ? 'warning' : 'success'}`}><i className="bi bi-tools" /></span><span className="data-row-main"><span className="data-row-title">{repair.title}</span><span className="data-row-subtitle">{localDate(repair.date, language)}{repair.mileageKm !== null ? ` · ${number(repair.mileageKm, language, 0)} km` : ''}</span></span><StatusPill tone={repair.status === 'scheduled' ? 'warning' : 'neutral'}>{t(repair.status)}</StatusPill><strong className="text-tabular text-nowrap">{money(repair.price, repair.currency, language)}</strong></button><ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="icon-button danger me-2" onConfirm={onDelete}><i className="bi bi-trash" /><span className="visually-hidden">{t('delete')} {repair.title}</span></ConfirmButton></div>;
}

function TripActivity({ trip, language, onEdit, onDelete }: { trip: Trip; language: 'en' | 'ro'; onEdit: () => void; onDelete: () => Promise<void> }) {
  const { t } = useSettings();
  return <div className="data-row p-0"><button className="data-row-action px-3 py-2" onClick={onEdit}><span className={`row-icon tone-${trip.status === 'scheduled' ? 'warning' : 'info'}`}><i className="bi bi-signpost-split" /></span><span className="data-row-main"><span className="data-row-title">{number(trip.distance, language)} km</span><span className="data-row-subtitle">{localDate(trip.date, language)} · {number(trip.consumption, language)} L/100 km</span></span><StatusPill tone={trip.status === 'scheduled' ? 'warning' : 'neutral'}>{t(trip.status)}</StatusPill>{trip.price !== null && <strong className="text-tabular text-nowrap">{money(trip.price, trip.currency, language)}</strong>}</button><ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="icon-button danger me-2" onConfirm={onDelete}><i className="bi bi-trash" /><span className="visually-hidden">{t('delete')} {t('trip')}</span></ConfirmButton></div>;
}

function MileageModal({ show, initial, onClose, onSave }: { show: boolean; initial: number | null; onClose: () => void; onSave: (value: number | null) => Promise<void> }) {
  const { t } = useSettings(); const [value, setValue] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (show) { setValue(initial?.toString() ?? ''); setError(''); } }, [show, initial]);
  async function submit(event: FormEvent) { event.preventDefault(); const parsed = value === '' ? null : Number(value); if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return setError(t('invalidNumber')); setBusy(true); try { await onSave(parsed); onClose(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); } }
  return <Modal title={t('currentMileage')} show={show} onClose={onClose}><form onSubmit={submit}><div className="modal-body"><label className="form-label" htmlFor="current-mileage">{t('mileage')} (km)</label><input id="current-mileage" autoFocus inputMode="numeric" type="number" min="0" step="1" className={`form-control ${error ? 'is-invalid' : ''}`} value={value} onChange={(event) => setValue(event.target.value)} />{error && <div className="invalid-feedback">{error}</div>}</div><div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div></form></Modal>;
}
