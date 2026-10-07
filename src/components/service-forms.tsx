'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { completeService, createServicePlan, updateServicePlan, type Currency, type ServicePlan } from '@/lib/database';
import { SERVICE_TEMPLATES } from '@/lib/fleet';
import { errorMessage, today } from '@/lib/format';
import { DateField } from './date-field';
import { useSettings } from './providers';
import { ConfirmButton, Modal } from './ui';

type Errors = Record<string, string>;
const FieldError = ({ error }: { error?: string }) => (error ? <div className="invalid-feedback">{error}</div> : null);
const optionalNumber = (value: string) => (value.trim() === '' ? null : Number(value));
const invalidPositive = (value: number | null) => value !== null && (!Number.isFinite(value) || value <= 0);

/** A recurring service for one vehicle, due every N km and/or every N months. */
export function ServicePlanForm({ show, carId, plan, currentMileage, onClose, onSaved, onDelete }: {
  show: boolean; carId: number; plan: ServicePlan | null; currentMileage: number | null; onClose: () => void; onSaved: () => Promise<void>; onDelete?: (plan: ServicePlan) => Promise<void>;
}) {
  const { t } = useSettings();
  const [title, setTitle] = useState(''); const [intervalKm, setIntervalKm] = useState(''); const [intervalMonths, setIntervalMonths] = useState('');
  const [lastDoneOn, setLastDoneOn] = useState(''); const [lastDoneKm, setLastDoneKm] = useState(''); const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setTitle(plan?.title ?? ''); setIntervalKm(plan?.intervalKm?.toString() ?? ''); setIntervalMonths(plan?.intervalMonths?.toString() ?? '');
    setLastDoneOn(plan?.lastDoneOn ?? ''); setLastDoneKm(plan?.lastDoneKm?.toString() ?? ''); setNotes(plan?.notes ?? '');
    setErrors({}); setFormError('');
  }, [show, plan]);

  function applyTemplate(index: number) {
    const template = SERVICE_TEMPLATES[index];
    setTitle(t(template.title)); setIntervalKm(template.intervalKm?.toString() ?? ''); setIntervalMonths(template.intervalMonths?.toString() ?? '');
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const km = optionalNumber(intervalKm); const months = optionalNumber(intervalMonths); const doneKm = optionalNumber(lastDoneKm); const nextErrors: Errors = {};
    if (!title.trim()) nextErrors.title = t('requiredFields');
    if (invalidPositive(km) || (km !== null && !Number.isInteger(km))) nextErrors.intervalKm = t('invalidNumber');
    if (invalidPositive(months) || (months !== null && !Number.isInteger(months))) nextErrors.intervalMonths = t('invalidNumber');
    if (km === null && months === null) nextErrors.intervalKm = t('intervalRequired');
    if (doneKm !== null && (!Number.isFinite(doneKm) || doneKm < 0)) nextErrors.lastDoneKm = t('invalidNumber');
    if (lastDoneOn && lastDoneOn > today()) nextErrors.lastDoneOn = t('completedDateError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const input = { carId, title, intervalKm: km, intervalMonths: months, lastDoneOn: lastDoneOn || null, lastDoneKm: doneKm, notes: notes || null };
      if (plan) await updateServicePlan(plan.id, input); else await createServicePlan(input);
      await onSaved(); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={plan ? t('editServicePlan') : t('addServicePlan')} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      {!plan && <div className="col-12"><span className="form-label d-block">{t('commonServices')}</span><div className="d-flex flex-wrap gap-2">{SERVICE_TEMPLATES.map((template, index) => <button type="button" key={template.title} className="btn btn-sm btn-outline-secondary" onClick={() => applyTemplate(index)}>{t(template.title)}</button>)}</div></div>}
      <div className="col-12"><label className="form-label required" htmlFor="plan-title">{t('title')}</label><input id="plan-title" autoFocus className={`form-control ${errors.title ? 'is-invalid' : ''}`} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /><FieldError error={errors.title} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="plan-km">{t('everyKm')}</label><div className="input-group"><input id="plan-km" inputMode="numeric" type="number" min="1" step="1" className={`form-control ${errors.intervalKm ? 'is-invalid' : ''}`} value={intervalKm} onChange={(event) => setIntervalKm(event.target.value)} /><span className="input-group-text">km</span><FieldError error={errors.intervalKm} /></div></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="plan-months">{t('everyMonths')}</label><div className="input-group"><input id="plan-months" inputMode="numeric" type="number" min="1" step="1" className={`form-control ${errors.intervalMonths ? 'is-invalid' : ''}`} value={intervalMonths} onChange={(event) => setIntervalMonths(event.target.value)} /><span className="input-group-text">{t('monthsShort')}</span><FieldError error={errors.intervalMonths} /></div></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="plan-last-date">{t('lastDoneOn')}</label><DateField id="plan-last-date" max={today()} invalid={Boolean(errors.lastDoneOn)} value={lastDoneOn} onChange={setLastDoneOn} /><FieldError error={errors.lastDoneOn} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="plan-last-km">{t('lastDoneKm')}</label><input id="plan-last-km" inputMode="numeric" type="number" min="0" step="1" placeholder={currentMileage?.toString()} className={`form-control ${errors.lastDoneKm ? 'is-invalid' : ''}`} value={lastDoneKm} onChange={(event) => setLastDoneKm(event.target.value)} /><FieldError error={errors.lastDoneKm} /></div>
      <div className="col-12"><p className="form-text mb-0">{t('servicePlanHint')}</p></div>
      <div className="col-12"><label className="form-label" htmlFor="plan-notes">{t('notes')}</label><input id="plan-notes" className="form-control" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer justify-content-between">
      {plan && onDelete ? <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { await onDelete(plan); onClose(); }}>{t('delete')}</ConfirmButton> : <span />}
      <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
    </div>
  </form></Modal>;
}

/** Marks a planned service as done: adds the repair to the vehicle's history and restarts the interval. */
export function CompleteServiceForm({ plan, estimatedKm, onClose, onSaved }: { plan: ServicePlan | null; estimatedKm: number | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, currency } = useSettings();
  const [date, setDate] = useState(today()); const [mileage, setMileage] = useState(''); const [price, setPrice] = useState('');
  const [entryCurrency, setEntryCurrency] = useState<Currency>(currency); const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setDate(today()); setMileage(estimatedKm?.toString() ?? ''); setPrice(''); setEntryCurrency(currency); setNotes(''); setErrors({}); setFormError('');
  }, [plan, estimatedKm, currency]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!plan) return; setFormError('');
    const km = optionalNumber(mileage); const amount = price === '' ? 0 : Number(price); const nextErrors: Errors = {};
    if (km !== null && (!Number.isFinite(km) || km < 0)) nextErrors.mileage = t('invalidNumber');
    if (!Number.isFinite(amount) || amount < 0) nextErrors.price = t('invalidNumber');
    if (date > today()) nextErrors.date = t('completedDateError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try { await completeService({ planId: plan.id, date, mileageKm: km, price: amount, currency: entryCurrency, notes: notes || null }); await onSaved(); onClose(); }
    catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={plan ? `${t('logService')} · ${plan.title}` : t('logService')} show={plan !== null} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><label className="form-label required" htmlFor="service-date">{t('date')}</label><DateField id="service-date" max={today()} invalid={Boolean(errors.date)} value={date} onChange={setDate} /><FieldError error={errors.date} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="service-km">{t('mileage')} (km)</label><input id="service-km" inputMode="numeric" type="number" min="0" step="1" className={`form-control ${errors.mileage ? 'is-invalid' : ''}`} value={mileage} onChange={(event) => setMileage(event.target.value)} /><FieldError error={errors.mileage} /></div>
      <div className="col-sm-8"><label className="form-label" htmlFor="service-price">{t('price')}</label><input id="service-price" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${errors.price ? 'is-invalid' : ''}`} value={price} onChange={(event) => setPrice(event.target.value)} /><FieldError error={errors.price} /></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="service-currency">{t('currency')}</label><select id="service-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      <div className="col-12"><label className="form-label" htmlFor="service-notes">{t('notes')}</label><input id="service-notes" className="form-control" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="col-12"><p className="form-text mb-0">{t('logServiceHint')}</p></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('logService')}</button></div>
  </form></Modal>;
}
