'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { errorMessage, today, tomorrow } from '@/lib/format';
import { CAR_DOCUMENT_BUCKET, removeObject, uploadComplianceAttachment } from '@/lib/storage';
import { useSettings } from './providers';
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
      <div className="col-sm-6"><label className="form-label required" htmlFor="repair-date">{t('date')}</label><input id="repair-date" type="date" className={`form-control ${errors.date ? 'is-invalid' : ''}`} max={status === 'done' ? today() : undefined} min={status === 'scheduled' ? tomorrow() : undefined} value={date} onChange={(event) => setDate(event.target.value)} /><FieldError error={errors.date} /></div>
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

  useEffect(() => {
    if (!show) return;
    setDate(trip?.date ?? today()); setStatus(trip?.status ?? 'done'); setDistance(trip?.distance?.toString() ?? '');
    setFuel(trip?.fuelUsed?.toString() ?? ''); setGasPrice(trip?.gasPrice?.toString() ?? '');
    setEntryCurrency(trip?.currency ?? currency); setErrors({}); setFormError('');
  }, [show, trip, currency]);

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
      const input = { status, currency: entryCurrency, date, distance: km, fuelUsed: liters, gasPrice: unitPrice };
      if (trip) await updateTrip(trip.id, input); else await createTrip({ carId, ...input });
      await onSaved(); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={`${trip ? t('edit') : t('add')} ${t('trip').toLowerCase()}`} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><StatusField value={status} onChange={setStatus} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-date">{t('date')}</label><input id="trip-date" type="date" className={`form-control ${errors.date ? 'is-invalid' : ''}`} max={status === 'done' ? today() : undefined} min={status === 'scheduled' ? tomorrow() : undefined} value={date} onChange={(event) => setDate(event.target.value)} /><FieldError error={errors.date} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-distance">{t('distance')} (km)</label><input id="trip-distance" autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" className={`form-control ${errors.distance ? 'is-invalid' : ''}`} value={distance} onChange={(event) => setDistance(event.target.value)} /><FieldError error={errors.distance} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="trip-fuel">{t('fuelUsed')} (L)</label><input id="trip-fuel" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${errors.fuel ? 'is-invalid' : ''}`} value={fuel} onChange={(event) => setFuel(event.target.value)} /><FieldError error={errors.fuel} /></div>
      <div className="col-sm-8"><label className="form-label" htmlFor="trip-gas-price">{t('gasPrice')}</label><input id="trip-gas-price" inputMode="decimal" type="number" min="0" step="0.001" className={`form-control ${errors.gasPrice ? 'is-invalid' : ''}`} value={gasPrice} onChange={(event) => setGasPrice(event.target.value)} /><FieldError error={errors.gasPrice} /></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="trip-currency">{t('currency')}</label><select id="trip-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      <div className="col-12"><div className="app-panel app-panel-body d-flex flex-wrap justify-content-between gap-3"><span><span className="metric-label d-block">{t('consumption')}</span><strong>{calculation.consumption.toFixed(1)} L/100 km</strong></span><span><span className="metric-label d-block">{t('cost')}</span><strong>{calculation.cost.toFixed(2)} {entryCurrency}</strong></span></div></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

export function ComplianceForm({ show, carId, kind, record, onClose, onSaved, onDelete }: { show: boolean; carId: number; kind: ComplianceKind; record?: ComplianceRecord | null; onClose: () => void; onSaved: () => Promise<void>; onDelete?: (record: ComplianceRecord) => Promise<void> }) {
  const { t } = useSettings();
  const [issued, setIssued] = useState(today()); const [expires, setExpires] = useState(today());
  const [file, setFile] = useState<File | null>(null); const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!show) return;
    setIssued(record?.issuedDate ?? today()); setExpires(record?.expiresDate ?? today());
    setFile(null); setRemove(false); setErrors({}); setFormError('');
  }, [show, record]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError(''); const nextErrors: Errors = {};
    if (!issued) nextErrors.issued = t('requiredFields');
    if (!expires || expires < issued) nextErrors.expires = t('expiryDateError');
    if (file && file.size > 20 * 1024 * 1024) nextErrors.file = 'The attachment must be smaller than 20 MB.';
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    let path = remove ? null : record?.attachmentPath ?? null;
    let name = remove ? null : record?.attachmentName ?? null;
    let type = remove ? null : record?.attachmentType ?? null;
    let uploaded: string | null = null;
    try {
      if (file) { uploaded = await uploadComplianceAttachment(file); path = uploaded; name = file.name; type = file.type || null; }
      const input = { issuedDate: issued, expiresDate: expires, attachmentPath: path, attachmentName: name, attachmentType: type };
      if (record) await updateComplianceRecord(record.id, input); else await createComplianceRecord({ carId, kind, ...input });
      if (record?.attachmentPath && record.attachmentPath !== path) await removeObject(CAR_DOCUMENT_BUCKET, record.attachmentPath);
      await onSaved(); onClose();
    } catch (caught) {
      if (uploaded) await removeObject(CAR_DOCUMENT_BUCKET, uploaded);
      setFormError(errorMessage(caught, t));
    } finally { setBusy(false); }
  }

  return <Modal title={`${record ? t('edit') : t('add')} ${kind.toUpperCase()}`} show={show} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><label className="form-label required" htmlFor={`${kind}-issued`}>{t('issuedDate')}</label><input id={`${kind}-issued`} autoFocus type="date" className={`form-control ${errors.issued ? 'is-invalid' : ''}`} value={issued} onChange={(event) => setIssued(event.target.value)} /><FieldError error={errors.issued} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor={`${kind}-expires`}>{t('expiresDate')}</label><input id={`${kind}-expires`} type="date" className={`form-control ${errors.expires ? 'is-invalid' : ''}`} min={issued} value={expires} onChange={(event) => setExpires(event.target.value)} /><FieldError error={errors.expires} /></div>
      <div className="col-12"><label className="form-label" htmlFor={`${kind}-attachment`}>{t('attachment')}</label><input id={`${kind}-attachment`} type="file" className={`form-control ${errors.file ? 'is-invalid' : ''}`} accept="image/*,application/pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setRemove(false); }} />{errors.file ? <div className="invalid-feedback">{errors.file}</div> : <div className="form-text">PDF or image, up to 20 MB.</div>}
        {record?.attachmentUrl && !file && <a className="d-inline-flex align-items-center mt-2" href={record.attachmentUrl} target="_blank" rel="noreferrer"><i className="bi bi-paperclip me-1" />{record.attachmentName || t('openAttachment')}</a>}
        {record?.attachmentPath && !file && <div className="form-check mt-2"><input id={`remove-${kind}`} type="checkbox" className="form-check-input" checked={remove} onChange={(event) => setRemove(event.target.checked)} /><label htmlFor={`remove-${kind}`} className="form-check-label">{t('removeAttachment')}</label></div>}
      </div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer justify-content-between">
      {record && onDelete ? <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={() => onDelete(record)}>{t('delete')}</ConfirmButton> : <span />}
      <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
    </div>
  </form></Modal>;
}
