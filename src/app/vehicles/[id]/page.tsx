'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { FineList } from '@/components/fine-list';
import { FineForm, FinePaidForm } from '@/components/fine-forms';
import { ComplianceForm, RepairForm, TripForm } from '@/components/maintenance-forms';
import { CompleteServiceForm, ServicePlanForm } from '@/components/service-forms';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, Empty, ErrorAlert, ListSkeleton, Modal, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import {
  deleteCar,
  deleteComplianceRecord,
  deleteRepair,
  deleteServicePlan,
  deleteTrip,
  getCar,
  getComplianceRecordsForCar,
  getRepairsForCar,
  getServicePlans,
  getTotalSpendForCar,
  getTripsForCar,
  updateCar,
  latestDocuments,
  updateCarMileage,
  type Car,
  type ComplianceKind,
  type ComplianceRecord,
  type Repair,
  type ServicePlan,
  type Trip,
} from '@/lib/database';
import { getCurrentAssignments, getDrivers, type Driver } from '@/lib/drivers';
import { CAR_DOCUMENTS, dailyKm, documentState, estimatedMileage, optionalCarDocuments, requiredCarDocuments, serviceDue } from '@/lib/fleet';
import { getFines, type Fine } from '@/lib/fines';
import { errorMessage, localDate, money, number } from '@/lib/format';
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
  const [currentDriver, setCurrentDriver] = useState<{ id: number; name: string } | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [planForm, setPlanForm] = useState<{ plan: ServicePlan | null } | null>(null);
  const [completing, setCompleting] = useState<ServicePlan | null>(null);
  const [fineForm, setFineForm] = useState<{ fine: Fine | null } | null>(null);
  const [payingFine, setPayingFine] = useState<Fine | null>(null);
  const [addDocOpen, setAddDocOpen] = useState(false);
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
      const [loadedCar, loadedRepairs, loadedTrips, loadedDocs, openAssignments, loadedDrivers, loadedPlans, loadedFines] = await Promise.all([
        getCar(carId), getRepairsForCar(carId), getTripsForCar(carId), getComplianceRecordsForCar(carId), getCurrentAssignments(), getDrivers(), getServicePlans(carId), getFines({ carId }),
      ]);
      setCar(loadedCar); setRepairs(loadedRepairs); setTrips(loadedTrips); setDocs(latestDocuments(loadedDocs, (doc) => doc.carId));
      setDrivers(loadedDrivers); setPlans(loadedPlans); setFines(loadedFines);
      const drivers = loadedDrivers;
      const assignment = openAssignments.find((value) => value.carId === carId);
      const driver = assignment && drivers.find((value) => value.id === assignment.driverId);
      setCurrentDriver(driver ? { id: driver.id, name: driver.fullName } : null);
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
    else if (kind && kind in CAR_DOCUMENTS) setDocKind(kind as ComplianceKind);
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
  const rate = useMemo(() => dailyKm(trips, carId), [trips, carId]);
  const odometer = car ? estimatedMileage(car, rate) : null;
  const documentKinds = car ? [...requiredCarDocuments(car), ...optionalCarDocuments(car).filter((kind) => documentFor(kind))] : [];
  const missingOptional = car ? optionalCarDocuments(car).filter((kind) => !documentFor(kind)) : [];
  if (!Number.isInteger(carId)) return <AppShell><ErrorAlert error={new Error('Invalid vehicle ID.')} /></AppShell>;

  return <AppShell>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} retryLabel={t('retry')} />}
    {loading ? <VehicleSkeleton /> : !car ? <div className="app-panel"><Empty icon="bi-car-front" title="Vehicle not found" action={<Link href="/" className="btn btn-primary">{t('garage')}</Link>} /></div> : <>
      <PageHeader
        back={<Link href="/" className="back-link"><i className="bi bi-arrow-left" />{t('garage')}</Link>}
        title={`${car.brand} ${car.model}`}
        subtitle={[car.plateNumber, car.year, car.description].filter(Boolean).join(' · ')}
        action={<button className="btn btn-outline-secondary" disabled={car.locked} onClick={() => setEditVehicle(true)}><i className="bi bi-pencil me-sm-2" /><span className="d-none d-sm-inline">{t('edit')}</span></button>}
      />

      <div className="vehicle-driver">
        {currentDriver
          ? <Link href={`/drivers/${currentDriver.id}`} className="vehicle-driver-link"><i className="bi bi-person" aria-hidden="true" /><span>{t('driver')}: <strong>{currentDriver.name}</strong></span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>
          : <Link href="/drivers" className="vehicle-driver-link muted"><i className="bi bi-person" aria-hidden="true" /><span>{t('noDriverAssigned')}</span><i className="bi bi-chevron-right" aria-hidden="true" /></Link>}
      </div>
      {car.locked && (
        <div className="vehicle-locked-banner" role="status">
          <span><i className="bi bi-lock me-2" aria-hidden="true" />{t('vehicleLockedBanner')}</span>
          <Link href="/settings#plan" className="btn btn-sm btn-outline-secondary">{t('seePlans')}</Link>
        </div>
      )}
      <div className="toolbar" hidden={car.locked}>
        <button className="btn btn-primary btn-island" onClick={() => { setEditingRepair(null); setRepairOpen(true); }}>{t('add')} {t('repair').toLowerCase()}<span className="btn-island-icon"><i className="bi bi-tools" /></span></button>
        <button className="btn btn-outline-secondary" onClick={() => { setEditingTrip(null); setTripOpen(true); }}><i className="bi bi-signpost-split me-2" />{t('add')} {t('trip').toLowerCase()}</button>
        <button className="btn btn-outline-secondary" onClick={() => setFineForm({ fine: null })}><i className="bi bi-receipt me-2" />{t('addFine')}</button>
      </div>

      {car.photoUrl && <div className="app-panel section-gap"><img src={car.photoUrl} alt={`${car.brand} ${car.model}`} className="vehicle-photo" /></div>}

      <div className="app-panel stat-strip">
        <button className="stat-item" disabled={car.locked} onClick={() => setMileageOpen(true)} aria-label={`${t('currentMileage')}: ${t('edit')}`}>
          <span className="metric-label">{t('currentMileage')}<i className="bi bi-pencil" /></span>
          <strong className="metric-value">{car.mileageKm === null ? '-' : `${number(car.mileageKm, language, 0)} km`}</strong>
        </button>
        <div className="stat-item"><span className="metric-label">{t('totalCost')}</span><strong className="metric-value">{money(totalCost, currency, language)}</strong></div>
        <div className="stat-item"><span className="metric-label">{t('loggedDistance')}</span><strong className="metric-value">{number(metrics.totalDistance, language, 0)} km</strong></div>
        <div className="stat-item"><span className="metric-label">{t('avgConsumption')}</span><strong className="metric-value">{number(metrics.average, language)} L/100</strong></div>
      </div>

      <section className="section-gap">
        <SectionHeader title={t('documents')} action={!car.locked && missingOptional.length > 0 && <button className="btn btn-sm btn-outline-secondary" onClick={() => setAddDocOpen(true)}><i className="bi bi-plus-lg me-1" />{t('addDocument')}</button>} />
        <div className="row g-3">{documentKinds.map((kind) => {
          const doc = documentFor(kind); const state = documentState(doc?.expiresDate);
          const tone = state === 'missing' ? 'neutral' : state === 'expired' ? 'danger' : state === 'soon' ? 'warning' : 'success';
          const label = state === 'missing' ? t('noDocument') : state === 'expired' ? t('expired') : state === 'soon' ? t('expiresSoon') : t('valid');
          return <div className="col-md-6" key={kind}><button className="app-panel data-row w-100 text-start" disabled={car.locked && !doc} onClick={() => setDocKind(kind)}><span className={`row-icon tone-${tone}`}><i className={`bi ${CAR_DOCUMENTS[kind].icon}`} /></span><span className="data-row-main"><span className="data-row-title">{t(CAR_DOCUMENTS[kind].label)}</span><span className="data-row-subtitle">{doc ? `${t('validUntil')} ${localDate(doc.expiresDate, language)}` : t('addDocument')}</span></span><StatusPill tone={tone}>{label}</StatusPill><i className="bi bi-chevron-right text-body-secondary" /></button></div>;
        })}</div>
        {car.ridesharing && <p className="small text-body-secondary mt-3 mb-0">{t('ridesharingDocumentsHint')}</p>}
      </section>

      <section className="section-gap">
        <SectionHeader title={t('serviceSchedule')} action={!car.locked && <button className="btn btn-sm btn-outline-secondary" onClick={() => setPlanForm({ plan: null })}><i className="bi bi-plus-lg me-1" />{t('addServicePlan')}</button>} />
        {plans.length ? <div className="data-list">{plans.map((plan, index) => {
          const due = serviceDue(plan, odometer, rate);
          const tone = due.state === 'overdue' ? 'danger' : due.state === 'soon' ? 'warning' : due.state === 'unknown' ? 'neutral' : 'success';
          const interval = [plan.intervalKm ? `${number(plan.intervalKm, language, 0)} km` : null, plan.intervalMonths ? `${plan.intervalMonths} ${t('monthsShort')}` : null].filter(Boolean).join(` ${t('or')} `);
          const dueText = due.state === 'unknown' ? t('lastServiceUnknown')
            : [due.kmLeft !== null ? (due.kmLeft < 0 ? t('kmOverdue').replace('{n}', number(-due.kmLeft, language, 0)) : t('kmLeft').replace('{n}', number(due.kmLeft, language, 0))) : null,
              due.dueDate ? `${t('dueAround')} ${localDate(due.dueDate, language)}` : null].filter(Boolean).join(' · ');
          return <div className="data-row p-0 reveal" style={stagger(index)} key={plan.id}>
            <button className="data-row-action px-3 py-2" disabled={car.locked} onClick={() => setPlanForm({ plan })}>
              <span className={`row-icon tone-${tone}`}><i className="bi bi-wrench-adjustable" /></span>
              <span className="data-row-main"><span className="data-row-title">{plan.title}</span><span className="data-row-subtitle">{t('every')} {interval} · {dueText}</span></span>
              <StatusPill tone={tone}>{t(`service_${due.state}` as const)}</StatusPill>
            </button>
            {!car.locked && <button type="button" className="btn btn-sm btn-outline-secondary me-2 text-nowrap" onClick={() => setCompleting(plan)}><i className="bi bi-check2 me-sm-1" /><span className="d-none d-sm-inline">{t('logService')}</span><span className="visually-hidden d-sm-none">{t('logService')}</span></button>}
          </div>;
        })}</div> : <div className="app-panel"><Empty icon="bi-wrench-adjustable" title={t('noServicePlans')} text={t('noServicePlansHint')} action={!car.locked && <button className="btn btn-primary" onClick={() => setPlanForm({ plan: null })}>{t('addServicePlan')}</button>} /></div>}
        {plans.length > 0 && <p className="small text-body-secondary mt-3 mb-0">{rate ? t('serviceRateHint').replace('{km}', number(rate * 7, language, 0)).replace('{odometer}', odometer === null ? '-' : number(odometer, language, 0)) : t('serviceNoRateHint')}</p>}
      </section>

      {fines.length > 0 && <section className="section-gap">
        <SectionHeader title={t('fines')} action={<button className="btn btn-sm btn-outline-secondary" onClick={() => setFineForm({ fine: null })}><i className="bi bi-plus-lg me-1" />{t('addFine')}</button>} />
        <FineList fines={fines} cars={[car]} drivers={drivers} showCar={false} onEdit={(fine) => setFineForm({ fine })} onPay={setPayingFine} onChanged={() => load(true)} />
      </section>}

      <section className="section-gap">
        <SectionHeader title={t('activity')} action={<div className="segmented">{(['all', 'repairs', 'trips'] as const).map((value) => <button key={value} className={activityFilter === value ? 'active' : ''} aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)}>{value === 'all' ? t('allActivity') : `${t(value)} ${value === 'repairs' ? repairs.length : trips.length}`}</button>)}</div>} />
        {activity.length ? <div className="data-list">{activity.map((item, index) => <div className="reveal" style={stagger(index)} key={item.key}>{item.kind === 'repair' ? <RepairActivity repair={item.repair} language={language} onEdit={() => { setEditingRepair(item.repair); setRepairOpen(true); }} onDelete={async () => { await deleteRepair(item.repair.id); await load(true); toast(t('deletedItem')); }} /> : <TripActivity trip={item.trip} language={language} onEdit={() => { setEditingTrip(item.trip); setTripOpen(true); }} onDelete={async () => { await deleteTrip(item.trip.id); await load(true); toast(t('deletedItem')); }} />}</div>)}</div> : <div className="app-panel"><Empty icon="bi-activity" title={activityFilter === 'repairs' ? t('noRepairs') : activityFilter === 'trips' ? t('noTrips') : t('noActivity')} /></div>}
      </section>

      <div className="border-top pt-4"><ConfirmButton title={t('deleteVehicle')} message={t('confirmDeleteVehicle')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { await deleteCar(car.id); router.push('/'); }}>{t('deleteVehicle')}</ConfirmButton></div>

      <VehicleForm show={editVehicle} car={car} onClose={() => setEditVehicle(false)} onSave={async (input) => { const oldPhoto = car.photoPath; await updateCar(car.id, input); if (oldPhoto && oldPhoto !== input.photoPath) await removeObject(CAR_PHOTO_BUCKET, oldPhoto); await load(true); toast(t('vehicleSaved')); }} />
      <MileageModal show={mileageOpen} initial={car.mileageKm} onClose={() => setMileageOpen(false)} onSave={async (value) => { await updateCarMileage(car.id, value); await load(true); toast(t('mileageSaved')); }} />
      <RepairForm show={repairOpen} carId={car.id} repair={editingRepair} defaultMileage={car.mileageKm} onClose={() => setRepairOpen(false)} onSaved={async () => { await load(true); toast(t('repairSaved')); }} />
      <TripForm show={tripOpen} carId={car.id} trip={editingTrip} onClose={() => setTripOpen(false)} onSaved={async () => { await load(true); toast(t('tripSaved')); }} />
      <ServicePlanForm show={planForm !== null} carId={car.id} plan={planForm?.plan ?? null} currentMileage={odometer} onClose={() => setPlanForm(null)} onSaved={async () => { await load(true); toast(t('servicePlanSaved')); }} onDelete={async (plan) => { await deleteServicePlan(plan.id); await load(true); toast(t('deletedItem')); }} />
      <CompleteServiceForm plan={completing} estimatedKm={odometer} onClose={() => setCompleting(null)} onSaved={async () => { await load(true); toast(t('serviceLogged')); }} />
      <FineForm show={fineForm !== null} fine={fineForm?.fine ?? null} cars={[car]} drivers={drivers} defaultCarId={car.id} onClose={() => setFineForm(null)} onSaved={async () => { await load(true); toast(t('fineSaved')); }} />
      <FinePaidForm fine={payingFine} onClose={() => setPayingFine(null)} onSaved={async () => { await load(true); toast(t('fineSaved')); }} />
      <Modal title={t('addDocument')} show={addDocOpen} onClose={() => setAddDocOpen(false)} variant="modal">
        <div className="modal-body"><div className="data-list">{missingOptional.map((kind) => <button key={kind} className="data-row w-100 text-start" onClick={() => { setAddDocOpen(false); setDocKind(kind); }}><span className="row-icon"><i className={`bi ${CAR_DOCUMENTS[kind].icon}`} /></span><span className="data-row-main"><span className="data-row-title">{t(CAR_DOCUMENTS[kind].label)}</span></span><i className="bi bi-chevron-right text-body-secondary" /></button>)}</div></div>
      </Modal>
      {docKind && <ComplianceForm show carId={car.id} kind={docKind} ridesharing={car.ridesharing} record={documentFor(docKind)} onClose={() => setDocKind(null)} onSaved={async () => { await load(true); toast(t('documentSaved')); }} onDelete={async (record) => { await deleteComplianceRecord(record.id); await removeObject(CAR_DOCUMENT_BUCKET, record.attachmentPath); await load(true); setDocKind(null); toast(t('deletedItem')); }} />}
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
