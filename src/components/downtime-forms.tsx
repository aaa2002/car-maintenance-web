'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createDowntime, DOWNTIME_REASONS, updateDowntime, type Downtime, type DowntimeReason } from '@/lib/database';
import { addDays, errorMessage, today } from '@/lib/format';
import { DateField } from './date-field';
import { useSettings } from './providers';
import { ConfirmButton, Modal } from './ui';

/** A period the vehicle cannot be rented out (in the shop, after an accident...). An empty end date means it still is. */
export function DowntimeForm({ show, carId, downtime, onClose, onSaved, onDelete }: {
  show: boolean; carId: number; downtime: Downtime | null; onClose: () => void; onSaved: () => Promise<void>; onDelete?: (downtime: Downtime) => Promise<void>;
}) {
  const { t } = useSettings();
  const [startsOn, setStartsOn] = useState(today()); const [endsOn, setEndsOn] = useState(''); const [ongoing, setOngoing] = useState(true);
  const [reason, setReason] = useState<DowntimeReason>('repair'); const [notes, setNotes] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setStartsOn(downtime?.startsOn ?? today()); setEndsOn(downtime?.endsOn ?? today()); setOngoing(downtime ? downtime.endsOn === null : true);
    setReason(downtime?.reason ?? 'repair'); setNotes(downtime?.notes ?? ''); setError('');
  }, [show, downtime]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!ongoing && endsOn < startsOn) { setError(t('expiryDateError')); return; }
    setBusy(true);
    try {
      const input = { carId, startsOn, endsOn: ongoing ? null : endsOn, reason, notes: notes || null };
      if (downtime) await updateDowntime(downtime.id, input); else await createDowntime(input);
      await onSaved(); onClose();
    } catch (caught) { setError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={downtime ? t('editDowntime') : t('takeOffRoad')} show={show} onClose={onClose}><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-sm-6"><label className="form-label required" htmlFor="downtime-start">{t('offRoadFrom')}</label><DateField id="downtime-start" max={today()} value={startsOn} onChange={setStartsOn} /></div>
      <div className="col-sm-6"><label className="form-label" htmlFor="downtime-reason">{t('reason')}</label><select id="downtime-reason" className="form-select" value={reason} onChange={(event) => setReason(event.target.value as DowntimeReason)}>{DOWNTIME_REASONS.map((value) => <option key={value} value={value}>{t(`downtime_${value}` as const)}</option>)}</select></div>
      <div className="col-12"><div className="form-check form-switch"><input id="downtime-ongoing" type="checkbox" role="switch" className="form-check-input" checked={ongoing} onChange={(event) => setOngoing(event.target.checked)} /><label className="form-check-label" htmlFor="downtime-ongoing">{t('stillOffRoad')}</label></div></div>
      {!ongoing && <div className="col-sm-6"><label className="form-label required" htmlFor="downtime-end">{t('lastDayOffRoad')}</label><DateField id="downtime-end" min={startsOn} max={today()} value={endsOn} onChange={setEndsOn} /></div>}
      <div className="col-12"><label className="form-label" htmlFor="downtime-notes">{t('notes')}</label><input id="downtime-notes" className="form-control" maxLength={200} placeholder={t('downtimeNotesPlaceholder')} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="col-12"><p className="form-text mb-0">{t('downtimeHint')}</p></div>
      {error && <div className="col-12"><div className="app-alert mb-0" role="alert">{error}</div></div>}
    </div></div>
    <div className="modal-footer justify-content-between">
      {downtime && onDelete ? <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { await onDelete(downtime); onClose(); }}>{t('delete')}</ConfirmButton> : <span />}
      <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
    </div>
  </form></Modal>;
}

/** Closes the open off-road period. */
export function BackOnRoadForm({ downtime, onClose, onSaved }: { downtime: Downtime | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const [endsOn, setEndsOn] = useState(today()); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (downtime) { setEndsOn(today() < downtime.startsOn ? downtime.startsOn : today()); setError(''); } }, [downtime]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!downtime) return; setBusy(true); setError('');
    // Back on the road on a day means the last day off the road was the day before (never before it started).
    const lastDay = addDays(endsOn, -1) < downtime.startsOn ? downtime.startsOn : addDays(endsOn, -1);
    try { await updateDowntime(downtime.id, { ...downtime, endsOn: lastDay }); await onSaved(); onClose(); }
    catch (caught) { setError(errorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  return <Modal title={t('backOnRoad')} show={downtime !== null} onClose={onClose} variant="modal"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12"><label className="form-label required" htmlFor="back-on-road">{t('backOnRoadOn')}</label><DateField id="back-on-road" min={downtime?.startsOn} max={today()} value={endsOn} onChange={setEndsOn} /><div className="form-text">{t('backOnRoadHint')}</div></div>
      {error && <div className="col-12"><div className="app-alert mb-0" role="alert">{error}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('backOnRoad')}</button></div>
  </form></Modal>;
}
