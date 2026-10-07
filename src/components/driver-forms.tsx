'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Car, Currency } from '@/lib/database';
import { assignDriver, createDriver, createSettlement, endAssignment, settlementNet, updateDriver, updateSettlement, type Assignment, type Driver, type Settlement, type SettlementInput } from '@/lib/drivers';
import { chargeAmount, getFinesForSettlement, getOpenFinesForDriver, linkFinesToSettlement, type Fine } from '@/lib/fines';
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
  const [rent, setRent] = useState(''); const [commission, setCommission] = useState(''); const [termErrors, setTermErrors] = useState<Record<string, string>>({});
  const [nameError, setNameError] = useState(''); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setFullName(driver?.fullName ?? ''); setPhone(driver?.phone ?? ''); setEmail(driver?.email ?? ''); setLicense(driver?.licenseNumber ?? '');
    setNotes(driver?.notes ?? ''); setActive(driver?.active ?? true); setNameError(''); setFormError('');
    setRent(driver?.weeklyRent?.toString() ?? ''); setCommission(driver?.commissionRate?.toString() ?? ''); setTermErrors({});
  }, [show, driver]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const weeklyRent = rent.trim() === '' ? null : Number(rent); const commissionRate = commission.trim() === '' ? null : Number(commission);
    const nextTermErrors: Record<string, string> = {};
    if (weeklyRent !== null && (!Number.isFinite(weeklyRent) || weeklyRent < 0)) nextTermErrors.rent = t('invalidNumber');
    if (commissionRate !== null && (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100)) nextTermErrors.commission = t('percentInvalid');
    setTermErrors(nextTermErrors);
    if (fullName.trim().length < 2) { setNameError(t('requiredFields')); return; }
    if (Object.keys(nextTermErrors).length) return;
    setNameError(''); setBusy(true);
    try {
      const input = { fullName, phone, email, licenseNumber: license, notes, active, weeklyRent, commissionRate };
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
      <div className="col-12"><span className="form-label d-block mb-0">{t('weeklyTerms')}</span><span className="form-text mt-0">{t('weeklyTermsHint')}</span></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="driver-rent">{t('weeklyRent')}</label><input id="driver-rent" inputMode="decimal" type="number" min="0" step="0.01" className={`form-control ${termErrors.rent ? 'is-invalid' : ''}`} value={rent} onChange={(event) => setRent(event.target.value)} /><FieldError error={termErrors.rent} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="driver-commission">{t('commissionRate')}</label><div className="input-group"><input id="driver-commission" inputMode="decimal" type="number" min="0" max="100" step="0.1" className={`form-control ${termErrors.commission ? 'is-invalid' : ''}`} value={commission} onChange={(event) => setCommission(event.target.value)} /><span className="input-group-text">%</span><FieldError error={termErrors.commission} /></div></div>
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
/** Commission as a share of the week's platform earnings, rounded to bani. */
export const commissionFor = (earnings: number, rate: number | null) => (rate ? Math.round(earnings * rate) / 100 : 0);

export function SettlementForm({ show, driver, settlement, cars, defaultCarId, onClose, onSaved }: { show: boolean; driver: Driver; settlement: Settlement | null; cars: Car[]; defaultCarId: number | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const driverId = driver.id;
  const { t, language, currency } = useSettings();
  const [weekStart, setWeekStart] = useState(mondayOf(today())); const [dueDate, setDueDate] = useState(addDays(mondayOf(today()), 7));
  const [carId, setCarId] = useState(''); const [entryCurrency, setEntryCurrency] = useState<Currency>(currency); const [notes, setNotes] = useState('');
  const [amounts, setAmounts] = useState<Record<AmountKey, string>>({} as Record<AmountKey, string>);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);
  const [openFines, setOpenFines] = useState<Fine[]>([]); const [includedFines, setIncludedFines] = useState<Fine[]>([]); const [pendingFineIds, setPendingFineIds] = useState<number[]>([]);
  // New weeks follow the driver's commission rate until the commission is typed in by hand.
  const commissionTouched = useRef(false);

  useEffect(() => {
    if (!show) return;
    setOpenFines([]); setIncludedFines([]); setPendingFineIds([]);
    commissionTouched.current = Boolean(settlement) || !driver.commissionRate;
    getOpenFinesForDriver(driverId).then(setOpenFines).catch(() => setOpenFines([]));
    if (settlement) getFinesForSettlement(settlement.id).then(setIncludedFines).catch(() => setIncludedFines([]));
    const week = settlement?.weekStart ?? mondayOf(today());
    setWeekStart(week); setDueDate(settlement?.dueDate ?? addDays(week, 7));
    setCarId(String(settlement?.carId ?? defaultCarId ?? '')); setEntryCurrency(settlement?.currency ?? currency); setNotes(settlement?.notes ?? '');
    setAmounts(Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, settlement ? String(settlement[key]) : key === 'vehicleRent' && driver.weeklyRent ? String(driver.weeklyRent) : ''])) as Record<AmountKey, string>);
    setErrors({}); setFormError('');
  }, [show, settlement, defaultCarId, currency, driverId, driver.weeklyRent, driver.commissionRate]);

  function changeAmount(key: AmountKey, value: string) {
    if (key === 'fleetCommission') commissionTouched.current = true;
    setAmounts((current) => {
      const next = { ...current, [key]: value };
      if ((key === 'boltEarnings' || key === 'uberEarnings') && !commissionTouched.current) {
        const earnings = (Number(next.boltEarnings) || 0) + (Number(next.uberEarnings) || 0);
        next.fleetCommission = earnings ? String(commissionFor(earnings, driver.commissionRate)) : '';
      }
      return next;
    });
  }
  const addableFines = openFines.filter((fine) => fine.currency === entryCurrency && !pendingFineIds.includes(fine.id));
  function addOpenFines() {
    const total = addableFines.reduce((sum, fine) => sum + chargeAmount(fine), 0);
    setAmounts((current) => ({ ...current, fines: String(Math.round(((Number(current.fines) || 0) + total) * 100) / 100) }));
    setPendingFineIds((current) => [...current, ...addableFines.map((fine) => fine.id)]);
  }

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
    try {
      const id = settlement ? (await updateSettlement(settlement.id, input), settlement.id) : await createSettlement(input);
      await linkFinesToSettlement(pendingFineIds, id);
      await onSaved(); onClose();
    }
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
        <div className="col-6 col-md-4" key={key}><label className="form-label" htmlFor={`settlement-${key}`}>{t(label)}</label><input id={`settlement-${key}`} inputMode="decimal" type="number" step="0.01" min={key === 'manualAdjustment' ? undefined : 0} className={`form-control ${errors[key] ? 'is-invalid' : ''}`} value={amounts[key] ?? ''} onChange={(event) => changeAmount(key, event.target.value)} /><FieldError error={errors[key]} /></div>
      ))}
      {(addableFines.length > 0 || pendingFineIds.length > 0 || includedFines.length > 0) && <div className="col-12"><div className="settlement-fines">
        <i className="bi bi-receipt" aria-hidden="true" />
        <span className="flex-grow-1 small">
          {includedFines.length > 0 && <span className="d-block">{t('finesIncluded').replace('{n}', String(includedFines.length)).replace('{amount}', money(includedFines.reduce((sum, fine) => sum + chargeAmount(fine), 0), entryCurrency, language))}</span>}
          {pendingFineIds.length > 0 && <span className="d-block">{t('finesAdded').replace('{n}', String(pendingFineIds.length))}</span>}
          {addableFines.length > 0 && <span className="d-block">{t('openFinesForDriver').replace('{n}', String(addableFines.length)).replace('{amount}', money(addableFines.reduce((sum, fine) => sum + chargeAmount(fine), 0), entryCurrency, language))}</span>}
        </span>
        {addableFines.length > 0 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addOpenFines}>{t('addToThisWeek')}</button>}
      </div></div>}
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
