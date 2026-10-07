'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Car, Currency } from '@/lib/database';
import { driverForCarOn, type Driver } from '@/lib/drivers';
import { carLabel } from '@/lib/fleet';
import { createFine, defaultDiscountUntil, discountOpen, FINE_KINDS, markFinePaid, updateFine, type Fine, type FineKind } from '@/lib/fines';
import { errorMessage, money, today } from '@/lib/format';
import { CAR_DOCUMENT_BUCKET, removeObject, uploadComplianceAttachment } from '@/lib/storage';
import { DateField } from './date-field';
import { FileDrop } from './file-drop';
import { useSettings } from './providers';
import { Modal } from './ui';

type Errors = Record<string, string>;
const FieldError = ({ error }: { error?: string }) => (error ? <div className="invalid-feedback">{error}</div> : null);

/** Records a fine; the driver defaults to whoever had the vehicle on the day of the offense. */
export function FineForm({ show, fine, cars, drivers, defaultCarId, onClose, onSaved }: {
  show: boolean; fine: Fine | null; cars: Car[]; drivers: Driver[]; defaultCarId?: number | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t, language } = useSettings();
  const [carId, setCarId] = useState(''); const [kind, setKind] = useState<FineKind>('camera');
  const [offenseDate, setOffenseDate] = useState(today()); const [offenseTime, setOffenseTime] = useState('12:00');
  const [receivedOn, setReceivedOn] = useState(today()); const [discountUntil, setDiscountUntil] = useState(defaultDiscountUntil(today()));
  const [reference, setReference] = useState(''); const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(''); const [entryCurrency, setEntryCurrency] = useState<Currency>('RON');
  const [driverId, setDriverId] = useState(''); const [suggestedDriverId, setSuggestedDriverId] = useState<number | null>(null);
  const [chargeDriver, setChargeDriver] = useState(true); const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null); const [remove, setRemove] = useState(false);
  const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);
  // Once the user picks a driver themselves, date or vehicle changes no longer overwrite it.
  const driverTouched = useRef(false);

  useEffect(() => {
    if (!show) return;
    const [date, time] = fine?.offenseAt.split('T') ?? [today(), '12:00'];
    setCarId(String(fine?.carId ?? defaultCarId ?? '')); setKind(fine?.kind ?? 'camera'); setOffenseDate(date); setOffenseTime(time);
    setReceivedOn(fine?.receivedOn ?? today()); setDiscountUntil(fine?.discountUntil ?? defaultDiscountUntil(fine?.receivedOn ?? today()));
    setReference(fine?.reference ?? ''); setDescription(fine?.description ?? ''); setAmount(fine?.amount?.toString() ?? ''); setEntryCurrency(fine?.currency ?? 'RON');
    setDriverId(fine?.driverId ? String(fine.driverId) : ''); setChargeDriver(fine?.chargeDriver ?? true); setNotes(fine?.notes ?? '');
    setFile(null); setRemove(false); setErrors({}); setFormError('');
    driverTouched.current = Boolean(fine);
  }, [show, fine, defaultCarId]);

  useEffect(() => {
    if (!show || !carId || !offenseDate) { setSuggestedDriverId(null); return; }
    let cancelled = false;
    driverForCarOn(Number(carId), offenseDate).then((id) => {
      if (cancelled) return;
      setSuggestedDriverId(id);
      if (!driverTouched.current) setDriverId(id ? String(id) : '');
    }).catch(() => { if (!cancelled) setSuggestedDriverId(null); });
    return () => { cancelled = true; };
  }, [show, carId, offenseDate]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const value = Number(amount); const nextErrors: Errors = {};
    if (!carId) nextErrors.carId = t('requiredFields');
    if (!Number.isFinite(value) || value <= 0) nextErrors.amount = t('invalidNumber');
    if (!/^\d{2}:\d{2}$/.test(offenseTime)) nextErrors.offenseTime = t('requiredFields');
    if (receivedOn < offenseDate) nextErrors.receivedOn = t('receivedBeforeOffense');
    if (file && file.size > 20 * 1024 * 1024) nextErrors.file = t('attachmentSizeError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    let path = remove ? null : fine?.attachmentPath ?? null; let name = remove ? null : fine?.attachmentName ?? null; let type = remove ? null : fine?.attachmentType ?? null;
    let uploaded: string | null = null;
    try {
      if (file) { uploaded = await uploadComplianceAttachment(file); path = uploaded; name = file.name; type = file.type || null; }
      const input = {
        carId: Number(carId), driverId: driverId ? Number(driverId) : null, kind, offenseAt: `${offenseDate}T${offenseTime}`, receivedOn, reference, description,
        amount: value, currency: entryCurrency, discountUntil: discountUntil || null, paidOn: fine?.paidOn ?? null, paidAmount: fine?.paidAmount ?? null,
        driverNamedOn: fine?.driverNamedOn ?? null, chargeDriver: Boolean(driverId) && chargeDriver,
        attachmentPath: path, attachmentName: name, attachmentType: type, notes,
      };
      if (fine) await updateFine(fine.id, input); else await createFine(input);
      if (fine?.attachmentPath && fine.attachmentPath !== path) await removeObject(CAR_DOCUMENT_BUCKET, fine.attachmentPath);
      await onSaved(); onClose();
    } catch (caught) {
      if (uploaded) await removeObject(CAR_DOCUMENT_BUCKET, uploaded);
      setFormError(errorMessage(caught, t));
    } finally { setBusy(false); }
  }

  const suggestedName = drivers.find((driver) => driver.id === suggestedDriverId)?.fullName;
  return <Modal title={fine ? t('editFine') : t('addFine')} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-7"><label className="form-label required" htmlFor="fine-car">{t('vehicle')}</label><select id="fine-car" className={`form-select ${errors.carId ? 'is-invalid' : ''}`} value={carId} onChange={(event) => setCarId(event.target.value)}><option value="" disabled>{t('vehicle')}</option>{cars.map((car) => <option key={car.id} value={car.id}>{carLabel(car)}</option>)}</select><FieldError error={errors.carId} /></div>
      <div className="col-sm-5"><label className="form-label" htmlFor="fine-kind">{t('fineKind')}</label><select id="fine-kind" className="form-select" value={kind} onChange={(event) => setKind(event.target.value as FineKind)}>{FINE_KINDS.map((value) => <option key={value} value={value}>{t(`fineKind_${value}` as const)}</option>)}</select></div>
      <div className="col-sm-7"><label className="form-label required" htmlFor="fine-date">{t('offenseDate')}</label><DateField id="fine-date" max={today()} value={offenseDate} onChange={setOffenseDate} /></div>
      <div className="col-sm-5"><label className="form-label required" htmlFor="fine-time">{t('offenseTime')}</label><input id="fine-time" type="time" className={`form-control ${errors.offenseTime ? 'is-invalid' : ''}`} value={offenseTime} onChange={(event) => setOffenseTime(event.target.value)} /><FieldError error={errors.offenseTime} /></div>
      <div className="col-12"><label className="form-label" htmlFor="fine-driver">{t('driver')}</label><select id="fine-driver" className="form-select" disabled={Boolean(fine?.settlementId)} value={driverId} onChange={(event) => { driverTouched.current = true; setDriverId(event.target.value); }}>
        <option value="">{t('noDriverFleetPays')}</option>
        {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}{driver.id === suggestedDriverId ? ` · ${t('hadTheCar')}` : ''}</option>)}
      </select><div className="form-text">{fine?.settlementId ? t('fineDeductedHint') : suggestedName ? t('fineDriverHint').replace('{name}', suggestedName) : t('fineNoDriverHint')}</div></div>
      {driverId && <div className="col-12"><div className="form-check form-switch"><input id="fine-charge" type="checkbox" role="switch" className="form-check-input" disabled={Boolean(fine?.settlementId)} checked={chargeDriver} onChange={(event) => setChargeDriver(event.target.checked)} /><label className="form-check-label" htmlFor="fine-charge">{t('chargeDriver')}</label></div></div>}
      <div className="col-sm-8"><label className="form-label required" htmlFor="fine-amount">{t('fineAmount')}</label><input id="fine-amount" inputMode="decimal" type="number" min="0.01" step="0.01" className={`form-control ${errors.amount ? 'is-invalid' : ''}`} value={amount} onChange={(event) => setAmount(event.target.value)} /><FieldError error={errors.amount} /></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="fine-currency">{t('currency')}</label><select id="fine-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="fine-received">{t('receivedOn')}</label><DateField id="fine-received" max={today()} invalid={Boolean(errors.receivedOn)} value={receivedOn} onChange={(value) => { setReceivedOn(value); setDiscountUntil(defaultDiscountUntil(value)); }} /><FieldError error={errors.receivedOn} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="fine-discount">{t('halfPriceUntil')}</label><DateField id="fine-discount" min={receivedOn} value={discountUntil} onChange={setDiscountUntil} /><div className="form-text">{t('halfPriceHint')}{Number(amount) > 0 ? ` ${money(Number(amount) / 2, entryCurrency, language)}.` : ''}</div></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="fine-reference">{t('fineReference')}</label><input id="fine-reference" className="form-control" maxLength={60} value={reference} onChange={(event) => setReference(event.target.value)} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="fine-description">{t('fineDescription')}</label><input id="fine-description" className="form-control" maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div className="col-12"><label className="form-label" htmlFor="fine-attachment">{t('fineScan')}</label><FileDrop id="fine-attachment" accept="image/*,application/pdf" hint={t('attachmentHint')} invalid={Boolean(errors.file)} file={file} onFile={(next) => { setFile(next); setRemove(false); }} existing={fine?.attachmentPath ? { name: fine.attachmentName || t('openAttachment'), url: fine.attachmentUrl } : null} removed={remove} onRemovedChange={setRemove} />{errors.file && <div className="invalid-feedback">{errors.file}</div>}</div>
      <div className="col-12"><label className="form-label" htmlFor="fine-notes">{t('notes')}</label><input id="fine-notes" className="form-control" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

/** Records the payment; while the 15-day window is open the amount defaults to half. */
export function FinePaidForm({ fine, onClose, onSaved }: { fine: Fine | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, language } = useSettings();
  const [paidOn, setPaidOn] = useState(today()); const [amount, setAmount] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!fine) return;
    setPaidOn(today()); setAmount(String(discountOpen(fine) ? Math.round(fine.amount / 2 * 100) / 100 : fine.amount)); setError('');
  }, [fine]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!fine) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) { setError(t('invalidNumber')); return; }
    setBusy(true); setError('');
    try { await markFinePaid(fine.id, paidOn, value); await onSaved(); onClose(); }
    catch (caught) { setError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={t('markFinePaid')} show={fine !== null} onClose={onClose} variant="modal"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      {fine && <div className="col-12"><p className="text-body-secondary mb-0">{t('fineAmount')}: {money(fine.amount, fine.currency, language)}{discountOpen(fine) ? ` · ${t('halfPriceApplies')}` : ''}</p></div>}
      <div className="col-sm-6"><label className="form-label required" htmlFor="fine-paid-on">{t('paidOn')}</label><DateField id="fine-paid-on" max={today()} value={paidOn} onChange={setPaidOn} /></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="fine-paid-amount">{t('amountPaid')}</label><input id="fine-paid-amount" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${error ? 'is-invalid' : ''}`} value={amount} onChange={(event) => setAmount(event.target.value)} /><FieldError error={error} /></div>
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}
