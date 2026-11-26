'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Currency } from '@/lib/database';
import type { Driver, Settlement } from '@/lib/drivers';
import { addDays, errorMessage, money, today } from '@/lib/format';
import { buyerGaps, draftTotals, grossLinesFromSettlement, INVOICE_ERRORS, issueInvoice, netsFromGross, type CompanyProfile, type DraftLine } from '@/lib/invoicing';
import { DateField } from './date-field';
import { useSettings } from './providers';
import { Modal } from './ui';

type EditableLine = { description: string; quantity: string; price: string; vatRate: string };
const UNITS = ['C62', 'WEE', 'DAY', 'KMT'] as const;

/** Maps a database error code to its translation, or the message as it is. */
export function invoiceErrorMessage(error: unknown, t: Parameters<typeof errorMessage>[1]) {
  const message = error instanceof Error ? error.message : '';
  const code = Object.keys(INVOICE_ERRORS).find((key) => message.includes(key)) as keyof typeof INVOICE_ERRORS | undefined;
  return code ? t(INVOICE_ERRORS[code]) : errorMessage(error, t);
}

/**
 * Drafts one invoice to a driver: from a week's settlement (rent, commission, optionally fines and expenses) or from
 * scratch. Amounts are entered including VAT by default, since that is what the driver pays.
 */
export function InvoiceDraftDialog({ show, profile, drivers, driverId, settlement, onClose, onIssued }: {
  show: boolean; profile: CompanyProfile; drivers: Driver[]; driverId?: number | null; settlement?: Settlement | null;
  onClose: () => void; onIssued: (id: number) => Promise<void>;
}) {
  const { t, language } = useSettings();
  const [driver, setDriver] = useState(''); const [currency, setCurrency] = useState<Currency>('RON');
  const [issueDate, setIssueDate] = useState(today()); const [dueDate, setDueDate] = useState(today());
  const [lines, setLines] = useState<EditableLine[]>([]); const [units, setUnits] = useState<string[]>([]);
  const [grossPrices, setGrossPrices] = useState(true); const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState(''); const [busy, setBusy] = useState(false);
  const rate = profile.vatPayer ? profile.defaultVatRate : 0;
  const weekNote = t('invoiceWeekNote');

  useEffect(() => {
    if (!show) return;
    const issue = today();
    setDriver(String(settlement?.driverId ?? driverId ?? '')); setCurrency(settlement?.currency ?? 'RON');
    setIssueDate(issue); setDueDate(addDays(issue, profile.paymentDays)); setGrossPrices(true); setErrors({}); setFormError('');
    // Settlement lines come back net of VAT; show them as the VAT-inclusive amounts the driver actually pays.
    const draft = settlement ? grossLinesFromSettlement(settlement, profile, { fines: false, expenses: false }, language) : [];
    const editable = draft.map((line) => ({ description: line.description, quantity: '1', price: String(line.gross), vatRate: String(line.vatRate) }));
    setLines(editable.length ? editable : [{ description: '', quantity: '1', price: '', vatRate: String(rate) }]);
    setUnits(draft.length ? draft.map(() => 'C62') : ['C62']);
    setNotes(settlement ? weekNote : '');
  }, [show, settlement, driverId, profile, language, rate, weekNote]);

  const update = (index: number, patch: Partial<EditableLine>) => setLines((current) => current.map((line, position) => (position === index ? { ...line, ...patch } : line)));
  const toDraft = (): DraftLine[] => {
    const vatOf = (line: EditableLine) => (profile.vatPayer ? Number(line.vatRate) : 0);
    // VAT-inclusive prices: single-unit lines are split so the total lands exactly on the amounts typed in.
    const nets = grossPrices ? netsFromGross(lines.map((line) => ({ gross: (Number(line.price) || 0) * (Number(line.quantity) || 0), vatRate: vatOf(line) }))) : [];
    return lines.map((line, index) => {
      const quantity = Number(line.quantity); const price = Number(line.price);
      const unitPrice = !grossPrices ? price : quantity ? Math.round((nets[index] / quantity) * 10000) / 10000 : 0;
      return { description: line.description.trim(), quantity, unit: units[index] ?? 'C62', unitPrice, vatRate: vatOf(line) };
    });
  };
  const totals = draftTotals(toDraft().map((line) => ({ ...line, quantity: Number.isFinite(line.quantity) ? line.quantity : 0, unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0 })), profile.vatPayer);

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const next: Record<string, string> = {};
    if (!driver) next.driver = t('requiredFields');
    else if (buyerGaps(drivers.find((value) => String(value.id) === driver) ?? { billing: { name: null, taxId: null, regNo: null, address: null, city: null, county: null } }).length) next.driver = t('buyerAddressMissing');
    lines.forEach((line, index) => {
      if (!line.description.trim()) next[`d${index}`] = t('requiredFields');
      if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) === 0 || line.quantity.trim() === '') next[`q${index}`] = t('invalidNumber');
      if (!Number.isFinite(Number(line.price)) || line.price.trim() === '') next[`p${index}`] = t('invalidNumber');
    });
    if (dueDate < issueDate) next.due = t('expiryDateError');
    setErrors(next); if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const id = await issueInvoice({ driverId: Number(driver), settlementId: settlement?.id ?? null, issueDate, dueDate, currency, lines: toDraft(), notes: notes.trim() || null });
      await onIssued(id); onClose();
    } catch (caught) { setFormError(invoiceErrorMessage(caught, t)); }
    finally { setBusy(false); }
  }

  const fmt = (value: number) => money(value, currency, language);
  return <Modal title={t('newInvoice')} show={show} onClose={() => !busy && onClose()} size="xl"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-md-6"><label className="form-label required" htmlFor="invoice-driver">{t('invoiceTo')}</label><select id="invoice-driver" className={`form-select ${errors.driver ? 'is-invalid' : ''}`} disabled={Boolean(settlement)} value={driver} onChange={(event) => setDriver(event.target.value)}><option value="" disabled>{t('chooseDriver')}</option>{drivers.map((value) => <option key={value.id} value={value.id}>{value.billing.name || value.fullName}{value.billing.name ? ` (${value.fullName})` : ''}</option>)}</select>{errors.driver && <div className="invalid-feedback">{errors.driver}</div>}</div>
      <div className="col-6 col-md-3"><label className="form-label required" htmlFor="invoice-issue">{t('issueDate')}</label><DateField id="invoice-issue" value={issueDate} onChange={(value) => { setIssueDate(value); setDueDate(addDays(value, profile.paymentDays)); }} /></div>
      <div className="col-6 col-md-3"><label className="form-label required" htmlFor="invoice-due">{t('dueDate')}</label><DateField id="invoice-due" min={issueDate} invalid={Boolean(errors.due)} value={dueDate} onChange={setDueDate} />{errors.due && <div className="invalid-feedback d-block">{errors.due}</div>}</div>

      <div className="col-12">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <span className="form-label mb-0">{t('invoiceLines')}</span>
          {profile.vatPayer && <div className="segmented"><button type="button" className={grossPrices ? 'active' : ''} onClick={() => setGrossPrices(true)}>{t('pricesWithVat')}</button><button type="button" className={!grossPrices ? 'active' : ''} onClick={() => setGrossPrices(false)}>{t('pricesWithoutVat')}</button></div>}
        </div>
        <div className="invoice-lines">{lines.map((line, index) => <div className="invoice-line" key={index}>
          <div className="invoice-line-description"><label className="visually-hidden" htmlFor={`line-d${index}`}>{t('description')}</label><input id={`line-d${index}`} className={`form-control ${errors[`d${index}`] ? 'is-invalid' : ''}`} placeholder={t('description')} maxLength={300} value={line.description} onChange={(event) => update(index, { description: event.target.value })} /></div>
          <div><label className="form-label small" htmlFor={`line-q${index}`}>{t('quantity')}</label><input id={`line-q${index}`} type="number" step="any" inputMode="decimal" className={`form-control ${errors[`q${index}`] ? 'is-invalid' : ''}`} value={line.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></div>
          <div><label className="form-label small" htmlFor={`line-u${index}`}>{t('unit')}</label><select id={`line-u${index}`} className="form-select" value={units[index] ?? 'C62'} onChange={(event) => setUnits((current) => { const next = [...current]; next[index] = event.target.value; return next; })}>{UNITS.map((unit) => <option key={unit} value={unit}>{t(`unit_${unit}`)}</option>)}</select></div>
          <div><label className="form-label small" htmlFor={`line-p${index}`}>{grossPrices && profile.vatPayer ? t('unitPriceWithVat') : t('unitPrice')}</label><input id={`line-p${index}`} type="number" step="0.01" inputMode="decimal" className={`form-control ${errors[`p${index}`] ? 'is-invalid' : ''}`} value={line.price} onChange={(event) => update(index, { price: event.target.value })} /></div>
          {profile.vatPayer && <div><label className="form-label small" htmlFor={`line-v${index}`}>{t('vatRate')}</label><select id={`line-v${index}`} className="form-select" value={line.vatRate} onChange={(event) => update(index, { vatRate: event.target.value })}>{[...new Set([profile.defaultVatRate, 21, 11, 0])].map((value) => <option key={value} value={value}>{value ? `${value}%` : t('vatExempt')}</option>)}</select></div>}
          <button type="button" className="icon-button danger align-self-end mb-1" disabled={lines.length === 1} onClick={() => { setLines((current) => current.filter((_, position) => position !== index)); setUnits((current) => current.filter((_, position) => position !== index)); }} aria-label={t('remove')}><i className="bi bi-trash" /></button>
        </div>)}</div>
        <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={() => { setLines((current) => [...current, { description: '', quantity: '1', price: '', vatRate: String(rate) }]); setUnits((current) => [...current, 'C62']); }}><i className="bi bi-plus-lg me-1" />{t('addLine')}</button>
      </div>

      <div className="col-md-7"><label className="form-label" htmlFor="invoice-notes">{t('notes')}</label><textarea id="invoice-notes" className="form-control" rows={2} maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="col-md-5"><div className="invoice-totals">
        <span>{t('totalNet')}</span><strong className="num">{fmt(totals.totalNet)}</strong>
        <span>{t('vat')}</span><strong className="num">{fmt(totals.totalVat)}</strong>
        <span className="is-total">{t('totalDue')}</span><strong className="num is-total">{fmt(totals.total)}</strong>
      </div></div>
      {!profile.vatPayer && <div className="col-12"><p className="form-text mb-0">{t('notVatPayerHint')}</p></div>}
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><span className="form-text me-auto">{t('nextInvoiceNumber').replace('{code}', `${profile.invoiceSeries}-${String(profile.nextInvoiceNumber).padStart(4, '0')}`)}</span><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('issueInvoice')}</button></div>
  </form></Modal>;
}
