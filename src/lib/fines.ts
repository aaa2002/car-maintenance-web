import type { Currency } from './database';
import { addDays, daysUntil } from './format';
import { CAR_DOCUMENT_BUCKET, removeObject, signedUrlMap } from './storage';
import { expectOk, supabase, unwrap, unwrapList } from './supabase';

export type FineKind = 'camera' | 'police' | 'parking' | 'toll' | 'other';
export const FINE_KINDS: FineKind[] = ['camera', 'police', 'parking', 'toll', 'other'];
/** Most Romanian fines are halved when paid within 15 days of receiving the report. */
export const FINE_DISCOUNT_DAYS = 15;

export type Fine = {
  id: number; carId: number; driverId: number | null; kind: FineKind;
  /** Local date and time of the offense, `YYYY-MM-DDTHH:mm`. */
  offenseAt: string; receivedOn: string; reference: string | null; description: string | null;
  amount: number; currency: Currency; discountUntil: string | null;
  paidOn: string | null; paidAmount: number | null; driverNamedOn: string | null;
  chargeDriver: boolean; settlementId: number | null;
  attachmentPath: string | null; attachmentUrl: string | null; attachmentName: string | null; attachmentType: string | null;
  notes: string | null;
};
type FineRow = {
  id: number; car_id: number; driver_id: number | null; kind: string; offense_at: string; received_on: string; reference: string | null; description: string | null;
  amount: number; currency: string; discount_until: string | null; paid_on: string | null; paid_amount: number | null; driver_named_on: string | null;
  charge_driver: boolean; settlement_id: number | null; attachment_path: string | null; attachment_name: string | null; attachment_type: string | null; notes: string | null;
};
const FINE_COLUMNS = 'id, car_id, driver_id, kind, offense_at, received_on, reference, description, amount, currency, discount_until, paid_on, paid_amount, driver_named_on, charge_driver, settlement_id, attachment_path, attachment_name, attachment_type, notes';

const pad = (value: number) => String(value).padStart(2, '0');
/** Timestamps are stored with their zone and shown in the browser's local time. */
export const toLocalDateTime = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const mapFine = (row: FineRow, attachmentUrl: string | null): Fine => ({
  id: row.id, carId: row.car_id, driverId: row.driver_id, kind: (FINE_KINDS.includes(row.kind as FineKind) ? row.kind : 'other') as FineKind,
  offenseAt: toLocalDateTime(row.offense_at), receivedOn: row.received_on, reference: row.reference, description: row.description,
  amount: row.amount, currency: row.currency === 'EUR' ? 'EUR' : 'RON', discountUntil: row.discount_until,
  paidOn: row.paid_on, paidAmount: row.paid_amount, driverNamedOn: row.driver_named_on, chargeDriver: row.charge_driver, settlementId: row.settlement_id,
  attachmentPath: row.attachment_path, attachmentUrl, attachmentName: row.attachment_name, attachmentType: row.attachment_type, notes: row.notes,
});
async function withUrls(rows: FineRow[]) {
  const urls = await signedUrlMap(CAR_DOCUMENT_BUCKET, rows.map((row) => row.attachment_path));
  return rows.map((row) => mapFine(row, row.attachment_path ? urls.get(row.attachment_path) ?? null : null));
}

export async function getFines(filter: { carId?: number; driverId?: number } = {}) {
  let query = supabase.from('fines').select(FINE_COLUMNS).order('offense_at', { ascending: false });
  if (filter.carId !== undefined) query = query.eq('car_id', filter.carId);
  if (filter.driverId !== undefined) query = query.eq('driver_id', filter.driverId);
  return withUrls(unwrapList(await query.returns<FineRow[]>(), 'Loading fines'));
}
/** Fines charged to a driver that no weekly settlement has deducted yet. */
export async function getOpenFinesForDriver(driverId: number) {
  return withUrls(unwrapList(await supabase.from('fines').select(FINE_COLUMNS).eq('driver_id', driverId).eq('charge_driver', true).is('settlement_id', null).order('offense_at').returns<FineRow[]>(), 'Loading fines'));
}
export async function getFinesForSettlement(settlementId: number) {
  return withUrls(unwrapList(await supabase.from('fines').select(FINE_COLUMNS).eq('settlement_id', settlementId).order('offense_at').returns<FineRow[]>(), 'Loading fines'));
}

export type FineInput = Omit<Fine, 'id' | 'attachmentUrl' | 'settlementId'>;
const finePayload = (input: FineInput) => ({
  car_id: input.carId, driver_id: input.driverId, kind: input.kind, offense_at: new Date(input.offenseAt).toISOString(), received_on: input.receivedOn,
  reference: input.reference?.trim() || null, description: input.description?.trim() || null, amount: input.amount, currency: input.currency,
  discount_until: input.discountUntil, paid_on: input.paidOn, paid_amount: input.paidOn ? input.paidAmount : null, driver_named_on: input.driverNamedOn,
  charge_driver: input.chargeDriver, attachment_path: input.attachmentPath, attachment_name: input.attachmentName, attachment_type: input.attachmentType,
  notes: input.notes?.trim() || null,
});
export async function createFine(input: FineInput) {
  return unwrap(await supabase.from('fines').insert(finePayload(input)).select('id').single<{ id: number }>(), 'Saving fine').id;
}
export async function updateFine(id: number, input: FineInput) { expectOk(await supabase.from('fines').update(finePayload(input)).eq('id', id), 'Saving fine'); }
export async function deleteFine(fine: Pick<Fine, 'id' | 'attachmentPath'>) {
  expectOk(await supabase.from('fines').delete().eq('id', fine.id), 'Deleting fine');
  await removeObject(CAR_DOCUMENT_BUCKET, fine.attachmentPath);
}
export async function markFinePaid(id: number, paidOn: string, paidAmount: number) {
  expectOk(await supabase.from('fines').update({ paid_on: paidOn, paid_amount: paidAmount }).eq('id', id), 'Saving fine');
}
export async function markDriverNamed(id: number, namedOn: string) {
  expectOk(await supabase.from('fines').update({ driver_named_on: namedOn }).eq('id', id), 'Saving fine');
}
/** Records that a weekly settlement deducted these fines from the driver. */
export async function linkFinesToSettlement(fineIds: number[], settlementId: number) {
  if (!fineIds.length) return;
  expectOk(await supabase.from('fines').update({ settlement_id: settlementId }).in('id', fineIds), 'Linking fines');
}

export const defaultDiscountUntil = (receivedOn: string) => addDays(receivedOn, FINE_DISCOUNT_DAYS);
/** What the driver is charged: what the fleet actually paid, or the full amount while it is unpaid. */
export const chargeAmount = (fine: Pick<Fine, 'amount' | 'paidAmount'>) => fine.paidAmount ?? fine.amount;
/** Camera fines go to the owner, who has to name the driver to the police. */
export const needsDriverNamed = (fine: Pick<Fine, 'kind' | 'driverNamedOn'>) => fine.kind === 'camera' && !fine.driverNamedOn;
export const discountOpen = (fine: Pick<Fine, 'discountUntil' | 'paidOn'>) => !fine.paidOn && Boolean(fine.discountUntil) && daysUntil(fine.discountUntil!) >= 0;
