'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Car, Currency } from '@/lib/database';
import { assignDriver, createDriver, createSettlement, endAssignment, settlementNet, updateDriver, updateSettlement, type Assignment, type Driver, type Settlement, type SettlementInput } from '@/lib/drivers';
import { addDays, errorMessage, localDate, mondayOf, money, today } from '@/lib/format';
import { DateField } from './date-field';
import { useSettings } from './providers';
import { Modal } from './ui';

const FieldError = ({ error }: { error?: string }) => (error ? <div className="invalid-feedback">{error}</div> : null);
const FormAlert = ({ error }: { error: string }) => (error ? <div className="col-12"><div className="app-alert mb-0" role="alert">{error}</div></div> : null);

export function DriverForm({ show, driver, onClose, onSave }: { show: boolean; driver?: Driver | null; onClose: () => void; onSave: (id: number) => Promise<void> }) {
  const { t } = useSettings();
  const [fullName, setFullName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [license, setLicense] = useState(''); const [notes, setNotes] = useState(''); const [active, setActive] = useState(true);
  const [nameError, setNameError] = useState(''); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setFullName(driver?.fullName ?? ''); setPhone(driver?.phone ?? ''); setEmail(driver?.email ?? ''); setLicense(driver?.licenseNumber ?? '');
    setNotes(driver?.notes ?? ''); setActive(driver?.active ?? true); setNameError(''); setFormError('');
  }, [show, driver]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (fullName.trim().length < 2) { setNameError(t('requiredFields')); return; }
    setNameError(''); setBusy(true);
    try {
      const input = { fullName, phone, email, licenseNumber: license, notes, active };
      const id = driver ? (await updateDriver(driver.id, input), driver.id) : await createDriver(input);
      await onSave(id); onClose();
    } catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={driver ? t('editDriver') : t('addDriver')} show={show} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12"><label className="form-label required" htmlFor="driver-name">{t('fullName')}</label><input id="driver-name" className={`form-control ${nameError ? 'is-invalid' : ''}`} maxLength={120} autoComplete="off" value={fullName} onChange={(event) => setFullName(event.target.value)} /><FieldError error={nameError} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="driver-phone">{t('phone')}</label><input id="driver-phone" type="tel" className="form-control" autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="driver-email">{t('email')}</label><input id="driver-email" type="email" className="form-control" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="driver-license">{t('licenseNumber')}</label><input id="driver-license" className="form-control" autoComplete="off" value={license} onChange={(event) => setLicense(event.target.value)} /></div>
      <div className="col-sm-6 d-flex align-items-end"><div className="form-check mb-2"><input id="driver-active" type="checkbox" className="form-check-input" checked={active} onChange={(event) => setActive(event.target.checked)} /><label className="form-check-label" htmlFor="driver-active">{t('activeDriver')}</label></div></div>
      <div className="col-12"><label className="form-label" htmlFor="driver-notes">{t('notes')}</label><textarea id="driver-notes" className="form-control" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <FormAlert error={formError} />
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

/** Assigns a vehicle from a date; any open assignment of this driver or this vehicle is closed the day before. */
export function AssignVehicleForm({ show, driverId, cars, currentCarId, onClose, onSaved }: { show: boolean; driverId: number; cars: Car[]; currentCarId: number | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const [carId, setCarId] = useState(''); const [startsOn, setStartsOn] = useState(today()); const [notes, setNotes] = useState('');
  const [carError, setCarError] = useState(''); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => { if (show) { setCarId(''); setStartsOn(today()); setNotes(''); setCarError(''); setFormError(''); } }, [show]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (!carId) { setCarError(t('requiredFields')); return; }
    setCarError(''); setBusy(true);
    try { await assignDriver(driverId, Number(carId), startsOn, notes.trim() || null); await onSaved(); onClose(); }
    catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={currentCarId ? t('changeVehicle') : t('assignVehicle')} show={show} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12"><label className="form-label required" htmlFor="assign-car">{t('vehicle')}</label><select id="assign-car" className={`form-select ${carError ? 'is-invalid' : ''}`} value={carId} onChange={(event) => setCarId(event.target.value)}>
        <option value="" disabled>{t('vehicle')}</option>
        {cars.filter((car) => car.id !== currentCarId).map((car) => <option key={car.id} value={car.id}>{car.brand} {car.model} ({car.year})</option>)}
      </select><FieldError error={carError} /></div>
      <div className="col-12"><label className="form-label required" htmlFor="assign-start">{t('startsOn')}</label><DateField id="assign-start" value={startsOn} onChange={setStartsOn} /></div>
      <div className="col-12"><label className="form-label" htmlFor="assign-notes">{t('notes')}</label><input id="assign-notes" className="form-control" maxLength={200} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <FormAlert error={formError} />
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}

export function EndAssignmentForm({ assignment, onClose, onSaved }: { assignment: Assignment | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const [endsOn, setEndsOn] = useState(today()); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (assignment) { setEndsOn(today() < assignment.startsOn ? assignment.startsOn : today()); setFormError(''); } }, [assignment]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!assignment) return; setBusy(true); setFormError('');
    try { await endAssignment(assignment.id, endsOn); await onSaved(); onClose(); }
    catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={t('endAssignment')} show={assignment !== null} onClose={onClose} variant="modal"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12"><p className="text-body-secondary mb-0">{assignment?.vehicleLabel}</p></div>
      <div className="col-12"><label className="form-label required" htmlFor="assign-end">{t('assignmentUntil')}</label><DateField id="assign-end" min={assignment?.startsOn} value={endsOn} onChange={setEndsOn} /></div>
      <FormAlert error={formError} />
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('endAssignment')}</button></div>
  </form></Modal>;
}

const AMOUNT_FIELDS = [
  ['boltEarnings', 'boltEarnings'], ['uberEarnings', 'uberEarnings'], ['bonuses', 'bonuses'], ['fleetCommission', 'fleetCommission'],
  ['vehicleRent', 'vehicleRent'], ['expenses', 'expenses'], ['fines', 'fines'], ['manualAdjustment', 'adjustment'], ['amountSettled', 'amountSettled'],
] as const;
type AmountKey = (typeof AMOUNT_FIELDS)[number][0];

/** One driver's week: earnings, what the fleet deducts, and what has been paid. Weeks always start on Monday. */
export function SettlementForm({ show, driverId, settlement, cars, defaultCarId, onClose, onSaved }: { show: boolean; driverId: number; settlement: Settlement | null; cars: Car[]; defaultCarId: number | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, language, currency } = useSettings();
  const [weekStart, setWeekStart] = useState(mondayOf(today())); const [dueDate, setDueDate] = useState(addDays(mondayOf(today()), 7));
  const [carId, setCarId] = useState(''); const [entryCurrency, setEntryCurrency] = useState<Currency>(currency); const [notes, setNotes] = useState('');
  const [amounts, setAmounts] = useState<Record<AmountKey, string>>({} as Record<AmountKey, string>);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    const week = settlement?.weekStart ?? mondayOf(today());
    setWeekStart(week); setDueDate(settlement?.dueDate ?? addDays(week, 7));
    setCarId(String(settlement?.carId ?? defaultCarId ?? '')); setEntryCurrency(settlement?.currency ?? currency); setNotes(settlement?.notes ?? '');
    setAmounts(Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, settlement ? String(settlement[key]) : ''])) as Record<AmountKey, string>);
    setErrors({}); setFormError('');
  }, [show, settlement, defaultCarId, currency]);

  const numbers = useMemo(() => Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, amounts[key] === '' || amounts[key] === undefined ? 0 : Number(amounts[key])])) as Record<AmountKey, number>, [amounts]);
  const net = settlementNet(numbers);
  const outstanding = net >= 0 ? Math.max(net - numbers.amountSettled, 0) : Math.min(net + numbers.amountSettled, 0);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const nextErrors: Record<string, string> = {};
    for (const [key] of AMOUNT_FIELDS) {
      const value = numbers[key];
      if (!Number.isFinite(value) || (key !== 'manualAdjustment' && value < 0)) nextErrors[key] = t('invalidNumber');
    }
    if (dueDate < weekStart) nextErrors.dueDate = t('expiryDateError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    const car = cars.find((value) => value.id === Number(carId));
    const input: SettlementInput = { driverId, carId: car?.id ?? null, vehicleLabel: car ? `${car.brand} ${car.model} (${car.year})` : null, weekStart, dueDate, currency: entryCurrency, notes, ...numbers };
    setBusy(true);
    try { if (settlement) await updateSettlement(settlement.id, input); else await createSettlement(input); await onSaved(); onClose(); }
    catch (caught) { setFormError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={settlement ? t('editSettlement') : t('addSettlement')} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><label className="form-label required" htmlFor="settlement-week">{t('weekStart')}</label><DateField id="settlement-week" value={weekStart} onChange={(value) => { const monday = mondayOf(value); setWeekStart(monday); if (!settlement) setDueDate(addDays(monday, 7)); }} /><div className="form-text">{t('weekOf').replace('{date}', localDate(weekStart, language))}</div></div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="settlement-due">{t('dueDate')}</label><DateField id="settlement-due" min={weekStart} invalid={Boolean(errors.dueDate)} value={dueDate} onChange={setDueDate} /><FieldError error={errors.dueDate} /></div>
      <div className="col-sm-8"><label className="form-label" htmlFor="settlement-car">{t('vehicle')}</label><select id="settlement-car" className="form-select" value={carId} onChange={(event) => setCarId(event.target.value)}><option value="">-</option>{cars.map((car) => <option key={car.id} value={car.id}>{car.brand} {car.model} ({car.year})</option>)}</select></div>
      <div className="col-sm-4"><label className="form-label" htmlFor="settlement-currency">{t('currency')}</label><select id="settlement-currency" className="form-select" value={entryCurrency} onChange={(event) => setEntryCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
      {AMOUNT_FIELDS.map(([key, label]) => (
        <div className="col-6 col-md-4" key={key}><label className="form-label" htmlFor={`settlement-${key}`}>{t(label)}</label><input id={`settlement-${key}`} inputMode="decimal" type="number" step="0.01" min={key === 'manualAdjustment' ? undefined : 0} className={`form-control ${errors[key] ? 'is-invalid' : ''}`} value={amounts[key] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [key]: event.target.value }))} /><FieldError error={errors[key]} /></div>
      ))}
      <div className="col-12"><label className="form-label" htmlFor="settlement-notes">{t('notes')}</label><input id="settlement-notes" className="form-control" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="col-12"><div className="app-panel app-panel-body d-flex flex-wrap justify-content-between gap-3">
        <span><span className="metric-label d-block">{net >= 0 ? t('payoutToDriver') : t('driverOwes')}</span><strong className="num">{money(Math.abs(net), entryCurrency, language)}</strong></span>
        <span className="text-end"><span className="metric-label d-block">{t('outstanding')}</span><strong className="num">{money(Math.abs(outstanding), entryCurrency, language)}</strong></span>
      </div></div>
      <FormAlert error={formError} />
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}
