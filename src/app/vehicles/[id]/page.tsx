'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { ComplianceForm, RepairForm, TripForm } from '@/components/maintenance-forms';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, Empty, ErrorAlert, ListSkeleton, Modal, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import {
  deleteCar,
  deleteComplianceRecord,
  deleteRepair,
  deleteTrip,
  getCar,
  getComplianceRecordsForCar,
  getRepairsForCar,
  getTotalSpendForCar,
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
  const [totalCost, setTotalCost] = useState(0);
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
  // Converted server-side with ECB rates; refetched whenever entries or the display currency change.
  useEffect(() => {
    if (!user || !Number.isInteger(carId)) return;
    let cancelled = false;
    getTotalSpendForCar(carId, currency).then((value) => { if (!cancelled) setTotalCost(value); }).catch(setError);
    return () => { cancelled = true; };
  }, [carId, currency, repairs, trips, user]);
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
    const totalDistance = trips.filter((item) => item.status === 'done').reduce((sum, item) => sum + item.distance, 0);
    const fuel = trips.filter((item) => item.status === 'done').reduce((sum, item) => sum + item.fuelUsed, 0);
    return { totalDistance, average: totalDistance > 0 ? fuel / totalDistance * 100 : 0 };
  }, [trips]);

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
        back={<Link href="/" className="back-link"><i className="bi bi-arrow-left" />{t('garage')}</Link>}
        title={`${car.brand} ${car.model}`}
        subtitle={`${car.year}${car.description ? ` · ${car.description}` : ''}`}
        action={<button className="btn btn-outline-secondary" onClick={() => setEditVehicle(true)}><i className="bi bi-pencil me-sm-2" /><span className="d-none d-sm-inline">{t('edit')}</span></button>}
      />

      <div className="toolbar">
        <button className="btn btn-primary btn-island" onClick={() => { setEditingRepair(null); setRepairOpen(true); }}>{t('add')} {t('repair').toLowerCase()}<span className="btn-island-icon"><i className="bi bi-tools" /></span></button>
        <button className="btn btn-outline-secondary" onClick={() => { setEditingTrip(null); setTripOpen(true); }}><i className="bi bi-signpost-split me-2" />{t('add')} {t('trip').toLowerCase()}</button>
      </div>

      {car.photoUrl && <div className="app-panel section-gap"><img src={car.photoUrl} alt={`${car.brand} ${car.model}`} className="vehicle-photo" /></div>}

      <div className="app-panel stat-strip">
        <button className="stat-item" onClick={() => setMileageOpen(true)} aria-label={`${t('currentMileage')}: ${t('edit')}`}>
          <span className="metric-label">{t('currentMileage')}<i className="bi bi-pencil" /></span>
          <strong className="metric-value">{car.mileageKm === null ? '-' : `${number(car.mileageKm, language, 0)} km`}</strong>
        </button>
        <div className="stat-item"><span className="metric-label">{t('totalCost')}</span><strong className="metric-value">{money(totalCost, currency, language)}</strong></div>
        <div className="stat-item"><span className="metric-label">{t('loggedDistance')}</span><strong className="metric-value">{number(metrics.totalDistance, language, 0)} km</strong></div>
        <div className="stat-item"><span className="metric-label">{t('avgConsumption')}</span><strong className="metric-value">{number(metrics.average, language)} L/100</strong></div>
      </div>

      <section className="section-gap">
        <SectionHeader title={t('documents')} />
        <div className="row g-4">{(['itp', 'rca'] as const).map((kind) => {
          const doc = documentFor(kind); const days = doc ? daysUntil(doc.expiresDate) : null;
          const tone = days === null ? 'neutral' : days < 0 ? 'danger' : days <= 7 ? 'warning' : 'success';
          const label = doc ? (days! < 0 ? t('expired') : days! <= 7 ? t('expiresSoon') : t('valid')) : t('noDocument');
          return <div className="col-md-6" key={kind}><button className="app-panel data-row w-100 text-start" onClick={() => setDocKind(kind)}><span className={`row-icon tone-${tone}`}><i className={`bi ${kind === 'itp' ? 'bi-clipboard2-check' : 'bi-shield-check'}`} /></span><span className="data-row-main"><span className="data-row-title">{kind.toUpperCase()}</span><span className="data-row-subtitle">{doc ? localDate(doc.expiresDate, language) : t('addDocument')}</span></span><StatusPill tone={tone}>{label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" /></button></div>;
        })}</div>
      </section>

      <section className="section-gap">
        <SectionHeader title={t('activity')} action={<div className="segmented">{(['all', 'repairs', 'trips'] as const).map((value) => <button key={value} className={activityFilter === value ? 'active' : ''} aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)}>{value === 'all' ? t('allActivity') : `${t(value)} ${value === 'repairs' ? repairs.length : trips.length}`}</button>)}</div>} />
        {activity.length ? <div className="data-list">{activity.map((item, index) => <div className="reveal" style={stagger(index)} key={item.key}>{item.kind === 'repair' ? <RepairActivity repair={item.repair} language={language} onEdit={() => { setEditingRepair(item.repair); setRepairOpen(true); }} onDelete={async () => { await deleteRepair(item.repair.id); await load(true); toast(t('deletedItem')); }} /> : <TripActivity trip={item.trip} language={language} onEdit={() => { setEditingTrip(item.trip); setTripOpen(true); }} onDelete={async () => { await deleteTrip(item.trip.id); await load(true); toast(t('deletedItem')); }} />}</div>)}</div> : <div className="app-panel"><Empty icon="bi-activity" title={activityFilter === 'repairs' ? t('noRepairs') : activityFilter === 'trips' ? t('noTrips') : t('noActivity')} /></div>}
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
  return <><div className="mb-4"><div className="skeleton mb-3" style={{ width: 70, height: 10 }} /><div className="skeleton mb-2" style={{ width: 260, height: 32 }} /><div className="skeleton" style={{ width: 170, height: 12 }} /></div><div className="d-flex gap-2 mb-4"><div className="skeleton" style={{ width: 140, height: 42 }} /><div className="skeleton" style={{ width: 120, height: 42 }} /></div><div className="app-panel stat-strip">{[0, 1, 2, 3].map((index) => <div className="stat-item" key={index}><div className="skeleton" style={{ width: 90, height: 10 }} /><div className="skeleton" style={{ width: '70%', height: 22 }} /></div>)}</div><ListSkeleton rows={4} /></>;
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
  async function submit(event: FormEvent) { event.preventDefault(); const parsed = value === '' ? null : Number(value); if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return setError(t('invalidNumber')); setBusy(true); try { await onSave(parsed); onClose(); } catch (caught) { setError(errorMessage(caught, t)); } finally { setBusy(false); } }
  return <Modal title={t('currentMileage')} show={show} onClose={onClose}><form onSubmit={submit}><div className="modal-body"><label className="form-label" htmlFor="current-mileage">{t('mileage')} (km)</label><input id="current-mileage" autoFocus inputMode="numeric" type="number" min="0" step="1" className={`form-control ${error ? 'is-invalid' : ''}`} value={value} onChange={(event) => setValue(event.target.value)} />{error && <div className="invalid-feedback">{error}</div>}</div><div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div></form></Modal>;
}
