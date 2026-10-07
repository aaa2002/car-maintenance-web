'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  createComplianceRecord,
  createRepair,
  createTrip,
  updateComplianceRecord,
  updateRepair,
  updateTrip,
  type ComplianceKind,
  type ComplianceRecord,
  type Currency,
  type Repair,
  type Trip,
} from '@/lib/database';
import { errorMessage, localDate, today, tomorrow } from '@/lib/format';
import { CAR_DOCUMENTS, defaultValidity, expiryFor, type Validity } from '@/lib/fleet';
import { CAR_DOCUMENT_BUCKET, removeObject, uploadComplianceAttachment } from '@/lib/storage';
import { useSettings } from './providers';
import { getDrivers, driverForCarOn, type Driver } from '@/lib/drivers';
import { DateField } from './date-field';
import { FileDrop } from './file-drop';
import { ConfirmButton, Modal } from './ui';

type Errors = Record<string, string>;
const validDateForStatus = (value: string, status: 'done' | 'scheduled') => Boolean(value) && (status === 'done' ? value <= today() : value > today());
const FieldError = ({ error }: { error?: string }) => error ? <div className="invalid-feedback">{error}</div> : null;

function StatusField({ value, onChange }: { value: 'done' | 'scheduled'; onChange: (value: 'done' | 'scheduled') => void }) {
  const { t } = useSettings();
  return <fieldset><legend className="form-label">{t('status')}</legend><div className="segmented w-100"><button type="button" className={`flex-fill ${value === 'done' ? 'active' : ''}`} aria-pressed={value === 'done'} onClick={() => onChange('done')}><i className="bi bi-check-circle me-2" />{t('done')}</button><button type="button" className={`flex-fill ${value === 'scheduled' ? 'active' : ''}`} aria-pressed={value === 'scheduled'} onClick={() => onChange('scheduled')}><i className="bi bi-clock me-2" />{t('scheduled')}</button></div></fieldset>;
}

export function RepairForm({ show, carId, repair, defaultMileage, onClose, onSaved }: { show: boolean; carId: number; repair?: Repair | null; defaultMileage: number | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, currency } = useSettings();
  const [title, setTitle] = useState(''); const [date, setDate] = useState(today());
  const [status, setStatus] = useState<'done' | 'scheduled'>('done'); const [price, setPrice] = useState('');
  const [mileage, setMileage] = useState(''); const [notes, setNotes] = useState('');
  const [entryCurrency, setEntryCurrency] = useState<Currency>(currency);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!show) return;
    setTitle(repair?.title ?? ''); setDate(repair?.date ?? today()); setStatus(repair?.status ?? 'done');
    setPrice(repair?.price?.toString() ?? ''); setMileage(repair?.mileageKm?.toString() ?? defaultMileage?.toString() ?? '');
    setNotes(repair?.notes ?? ''); setEntryCurrency(repair?.currency ?? currency); setErrors({}); setFormError('');
  }, [show, repair, defaultMileage, currency]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const amount = Number(price); const km = mileage === '' ? null : Number(mileage); const nextErrors: Errors = {};
    if (!title.trim()) nextErrors.title = t('requiredFields');
    if (!validDateForStatus(date, status)) nextErrors.date = status === 'done' ? t('completedDateError') : t('scheduledDateError');
    if (!Number.isFinite(amount) || amount < 0) nextErrors.price = t('invalidNumber');
    if (km !== null && (!Number.isFinite(km) || km < 0)) nextErrors.mileage = t('invalidNumber');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const input = { status, currency: entryCurrency, mileageKm: km, title, date, price: amount, notes: notes || null };
      if (repair) await updateRepair(repair.id, input); else await createRepair({ carId, ...input });
      await onSaved(); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={`${repair ? t('edit') : t('add')} ${t('repair').toLowerCase()}`} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12"><label className="form-label required" htmlFor="repair-title">{t('title')}</label><input id="repair-title" autoFocus className={`form-control ${errors.title ? 'is-invalid' : ''}`} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /><FieldError error={errors.title} /></div>
      <div className="col-sm-6"><StatusField value={status} onChange={setStatus} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="repair-date">{t('date')}</label><DateField id="repair-date" invalid={Boolean(errors.date)} max={status === 'done' ? today() : undefined} min={status === 'scheduled' ? tomorrow() : undefined} value={date} onChange={setDate} /><FieldError error={errors.date} /></div>
      <div className="col-sm-8"><label className="form-label required" htmlFor="repair-price">{t('price')}</label><input id="repair-price" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${errors.price ? 'is-invalid' : ''}`} value={price} onChange={(event) => setPrice(event.target.value)} /><FieldError error={errors.price} /></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="repair-currency">{t('currency')}</label><select id="repair-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      <div className="col-12"><label className="form-label" htmlFor="repair-mileage">{t('mileage')} (km)</label><input id="repair-mileage" inputMode="numeric" type="number" min="0" step="1" className={`form-control ${errors.mileage ? 'is-invalid' : ''}`} value={mileage} onChange={(event) => setMileage(event.target.value)} /><FieldError error={errors.mileage} /></div>
      <div className="col-12"><label className="form-label" htmlFor="repair-notes">{t('notes')}</label><textarea id="repair-notes" className="form-control" rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

export function TripForm({ show, carId, trip, onClose, onSaved }: { show: boolean; carId: number; trip?: Trip | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, currency } = useSettings();
  const [date, setDate] = useState(today()); const [status, setStatus] = useState<'done' | 'scheduled'>('done');
  const [distance, setDistance] = useState(''); const [fuel, setFuel] = useState(''); const [gasPrice, setGasPrice] = useState('');
  const [entryCurrency, setEntryCurrency] = useState<Currency>(currency);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]); const [driverId, setDriverId] = useState(''); const [assignedId, setAssignedId] = useState<number | null>(null);

  useEffect(() => {
    if (!show) return;
    setDate(trip?.date ?? today()); setStatus(trip?.status ?? 'done'); setDistance(trip?.distance?.toString() ?? '');
    setFuel(trip?.fuelUsed?.toString() ?? ''); setGasPrice(trip?.gasPrice?.toString() ?? '');
    setEntryCurrency(trip?.currency ?? currency); setErrors({}); setFormError('');
    setDriverId(trip?.driverId ? String(trip.driverId) : '');
    getDrivers().then(setDrivers).catch(() => setDrivers([]));
  }, [show, trip, currency]);

  // The default "driven by" is whoever had this vehicle assigned on the trip date.
  useEffect(() => {
    if (!show || !date) return;
    let cancelled = false;
    driverForCarOn(carId, date).then((id) => { if (!cancelled) setAssignedId(id); }).catch(() => { if (!cancelled) setAssignedId(null); });
    return () => { cancelled = true; };
  }, [show, carId, date]);
  const assignedName = drivers.find((driver) => driver.id === assignedId)?.fullName;

  const calculation = useMemo(() => {
    const km = Number(distance); const liters = Number(fuel); const unitPrice = Number(gasPrice);
    return { consumption: km > 0 && Number.isFinite(liters) ? liters / km * 100 : 0, cost: Number.isFinite(liters * unitPrice) ? liters * unitPrice : 0 };
  }, [distance, fuel, gasPrice]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const km = Number(distance); const liters = Number(fuel); const unitPrice = gasPrice === '' ? null : Number(gasPrice); const nextErrors: Errors = {};
    if (!validDateForStatus(date, status)) nextErrors.date = status === 'done' ? t('completedDateError') : t('scheduledDateError');
    if (!Number.isFinite(km) || km <= 0) nextErrors.distance = t('distancePositive');
    if (!Number.isFinite(liters) || liters < 0) nextErrors.fuel = t('invalidNumber');
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) nextErrors.gasPrice = t('invalidNumber');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const input = { status, currency: entryCurrency, date, distance: km, fuelUsed: liters, gasPrice: unitPrice, driverId: driverId ? Number(driverId) : null };
      if (trip) await updateTrip(trip.id, input); else await createTrip({ carId, ...input });
      await onSaved(); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={`${trip ? t('edit') : t('add')} ${t('trip').toLowerCase()}`} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><StatusField value={status} onChange={setStatus} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-date">{t('date')}</label><DateField id="trip-date" invalid={Boolean(errors.date)} max={status === 'done' ? today() : undefined} min={status === 'scheduled' ? tomorrow() : undefined} value={date} onChange={setDate} /><FieldError error={errors.date} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-distance">{t('distance')} (km)</label><input id="trip-distance" autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" className={`form-control ${errors.distance ? 'is-invalid' : ''}`} value={distance} onChange={(event) => setDistance(event.target.value)} /><FieldError error={errors.distance} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-fuel">{t('fuelUsed')} (L)</label><input id="trip-fuel" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${errors.fuel ? 'is-invalid' : ''}`} value={fuel} onChange={(event) => setFuel(event.target.value)} /><FieldError error={errors.fuel} /></div>
      <div className="col-sm-8"><label className="form-label" htmlFor="trip-gas-price">{t('gasPrice')}</label><input id="trip-gas-price" inputMode="decimal" type="number" min="0" step="0.001" className={`form-control ${errors.gasPrice ? 'is-invalid' : ''}`} value={gasPrice} onChange={(event) => setGasPrice(event.target.value)} /><FieldError error={errors.gasPrice} /></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="trip-currency">{t('currency')}</label><select id="trip-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      {drivers.length > 0 && <div className="col-12"><label className="form-label" htmlFor="trip-driver">{t('drivenBy')}</label><select id="trip-driver" className="form-select" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
        <option value="">{assignedName ? t('assignedDriverNamed').replace('{name}', assignedName) : t('assignedDriverNone')}</option>
        {drivers.filter((driver) => driver.active || String(driver.id) === driverId).map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
      </select><div className="form-text">{t('drivenByHint')}</div></div>}
      <div className="col-12"><div className="app-panel app-panel-body d-flex flex-wrap justify-content-between gap-3"><span><span className="metric-label d-block">{t('consumption')}</span><strong>{calculation.consumption.toFixed(1)} L/100 km</strong></span><span><span className="metric-label d-block">{t('cost')}</span><strong>{calculation.cost.toFixed(2)} {entryCurrency}</strong></span></div></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

type DocumentRecord = { issuedDate: string; expiresDate: string; attachmentPath: string | null; attachmentUrl: string | null; attachmentName: string | null; attachmentType: string | null };
export type DocumentInput = { issuedDate: string; expiresDate: string; attachmentPath: string | null; attachmentName: string | null; attachmentType: string | null };
const sameValidity = (a: Validity, b: Validity) => (a.days ?? 0) === (b.days ?? 0) && (a.months ?? 0) === (b.months ?? 0);

/** Any dated document (vehicle or driver): pick a validity preset and the expiry date follows the issue date. */
export function DocumentForm({ show, idPrefix, title, record, validity, initialValidity, hint, onClose, onSubmit, onDelete }: {
  show: boolean; idPrefix: string; title: string; record?: DocumentRecord | null; validity: Validity[]; initialValidity: Validity; hint?: ReactNode;
  onClose: () => void; onSubmit: (input: DocumentInput) => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const { t, language } = useSettings();
  const [issued, setIssued] = useState(today()); const [expires, setExpires] = useState(today()); const [preset, setPreset] = useState<Validity | null>(null);
  const [file, setFile] = useState<File | null>(null); const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!show) return;
    // An expired document is being renewed: start from today with the usual validity.
    const renewing = Boolean(record && record.expiresDate < today());
    const start = record && !renewing ? record.issuedDate : today();
    setIssued(start); setExpires(record && !renewing ? record.expiresDate : expiryFor(start, initialValidity)); setPreset(record && !renewing ? null : initialValidity);
    setFile(null); setRemove(false); setErrors({}); setFormError('');
  }, [show, record, initialValidity]);

  function changeIssued(value: string) { setIssued(value); if (preset) setExpires(expiryFor(value, preset)); }
  function choosePreset(value: Validity) { setPreset(value); setExpires(expiryFor(issued, value)); }
  const presetLabel = (value: Validity) => value.days ? t('validityDays').replace('{n}', String(value.days)) : value.months! % 12 === 0 && value.months! >= 12 ? t(value.months === 12 ? 'validityYear' : 'validityYears').replace('{n}', String(value.months! / 12)) : t('validityMonths').replace('{n}', String(value.months));

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError(''); const nextErrors: Errors = {};
    if (!issued) nextErrors.issued = t('requiredFields');
    if (!expires || expires < issued) nextErrors.expires = t('expiryDateError');
    if (file && file.size > 20 * 1024 * 1024) nextErrors.file = t('attachmentSizeError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    let path = remove ? null : record?.attachmentPath ?? null;
    let name = remove ? null : record?.attachmentName ?? null;
    let type = remove ? null : record?.attachmentType ?? null;
    let uploaded: string | null = null;
    try {
      if (file) { uploaded = await uploadComplianceAttachment(file); path = uploaded; name = file.name; type = file.type || null; }
      await onSubmit({ issuedDate: issued, expiresDate: expires, attachmentPath: path, attachmentName: name, attachmentType: type });
      if (record?.attachmentPath && record.attachmentPath !== path) await removeObject(CAR_DOCUMENT_BUCKET, record.attachmentPath);
      onClose();
    } catch (caught) {
      if (uploaded) await removeObject(CAR_DOCUMENT_BUCKET, uploaded);
      setFormError(errorMessage(caught, t));
    } finally { setBusy(false); }
  }

  return <Modal title={title} show={show} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      {record && record.expiresDate < today() && <div className="col-12"><p className="form-text mb-0">{t('renewingHint').replace('{date}', localDate(record.expiresDate, language))}</p></div>}
      <div className="col-12"><label className="form-label required" htmlFor={`${idPrefix}-issued`}>{t('issuedDate')}</label><DateField id={`${idPrefix}-issued`} autoFocus invalid={Boolean(errors.issued)} value={issued} onChange={changeIssued} /><FieldError error={errors.issued} /></div>
      {validity.length > 0 && <div className="col-12"><span className="form-label d-block">{t('validFor')}</span><div className="segmented flex-wrap">{validity.map((value) => <button type="button" key={presetLabel(value)} className={preset && sameValidity(preset, value) ? 'active' : ''} aria-pressed={Boolean(preset && sameValidity(preset, value))} onClick={() => choosePreset(value)}>{presetLabel(value)}</button>)}</div></div>}
      <div className="col-12"><label className="form-label required" htmlFor={`${idPrefix}-expires`}>{t('expiresDate')}</label><DateField id={`${idPrefix}-expires`} invalid={Boolean(errors.expires)} min={issued} value={expires} onChange={(value) => { setExpires(value); setPreset(null); }} /><FieldError error={errors.expires} /></div>
      {hint && <div className="col-12">{hint}</div>}
      <div className="col-12"><label className="form-label" htmlFor={`${idPrefix}-attachment`}>{t('attachment')}</label><FileDrop id={`${idPrefix}-attachment`} accept="image/*,application/pdf" hint={t('attachmentHint')} invalid={Boolean(errors.file)} file={file} onFile={(next) => { setFile(next); setRemove(false); }} existing={record?.attachmentPath ? { name: record.attachmentName || t('openAttachment'), url: record.attachmentUrl } : null} removed={remove} onRemovedChange={setRemove} />{errors.file && <div className="invalid-feedback">{errors.file}</div>}
      </div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer justify-content-between">
      {record && onDelete ? <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={onDelete}>{t('delete')}</ConfirmButton> : <span />}
      <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
    </div>
  </form></Modal>;
}

export function ComplianceForm({ show, carId, kind, ridesharing, record, onClose, onSaved, onDelete }: { show: boolean; carId: number; kind: ComplianceKind; ridesharing: boolean; record?: ComplianceRecord | null; onClose: () => void; onSaved: () => Promise<void>; onDelete?: (record: ComplianceRecord) => Promise<void> }) {
  const { t } = useSettings();
  const meta = CAR_DOCUMENTS[kind];
  const initialValidity = useMemo(() => defaultValidity(kind, ridesharing), [kind, ridesharing]);
  return <DocumentForm
    show={show} idPrefix={kind} title={`${record ? (record.expiresDate < today() ? t('renew') : t('edit')) : t('add')} ${t(meta.label)}`} record={record} validity={meta.validity} initialValidity={initialValidity}
    hint={kind === 'vignette' ? <a className="small" href="https://www.etoll.ro" target="_blank" rel="noreferrer">{t('buyVignette')}<i className="bi bi-box-arrow-up-right ms-1" aria-hidden="true" /></a> : kind === 'itp' && ridesharing ? <p className="form-text mb-0">{t('itpRidesharingHint')}</p> : undefined}
    onClose={onClose}
    onSubmit={async (input) => { if (record) await updateComplianceRecord(record.id, input); else await createComplianceRecord({ carId, kind, ...input }); await onSaved(); }}
    onDelete={record && onDelete ? () => onDelete(record) : undefined}
  />;
}
