// Saving Bolt/Uber imports: earnings per driver and week, ride invoices (deduplicated by number) and the import log.
import type { Currency } from './database';
import { createDriver, rememberPlatformNames, type Driver } from './drivers';
import { mondayOf } from './format';
import type { DriverIdentity, EarningsRow, PaymentMethod, RideInvoice } from './platform-files';
import { nameKey, type Platform } from './platform-import';
import { removeObject, signedUrlMap } from './storage';
import { expectOk, supabase, unwrap, unwrapList } from './supabase';

export const RIDE_INVOICE_BUCKET = 'ride-invoices';

// ---------------------------------------------------------------------------------------------------------------
// Recognising drivers. Platform ids never change, so they win; then e-mail and phone (Bolt exports them),
// then names already learned on this driver, then the same name in any order, case and accents.

export type MatchReason = 'platformId' | 'email' | 'phone' | 'alias' | 'name';
export function matchIdentity(identity: Pick<DriverIdentity, 'platform' | 'platformId' | 'name' | 'email' | 'phone'>, drivers: Driver[]): { driver: Driver; by: MatchReason } | null {
  const idField = identity.platform === 'bolt' ? 'boltDriverId' : 'uberDriverId';
  const key = nameKey(identity.name);
  const checks: [MatchReason, (driver: Driver) => boolean][] = [
    ['platformId', (driver) => Boolean(identity.platformId) && driver[idField] === identity.platformId],
    ['email', (driver) => Boolean(identity.email) && driver.email?.toLowerCase() === identity.email],
    ['phone', (driver) => Boolean(identity.phone) && phoneKey(driver.phone) === phoneKey(identity.phone)],
    ['alias', (driver) => driver.platformNames.some((alias) => nameKey(alias) === key)],
    ['name', (driver) => nameKey(driver.fullName) === key],
  ];
  for (const [by, test] of checks) {
    const driver = drivers.find(test);
    if (driver) return { driver, by };
  }
  return null;
}
const phoneKey = (value: string | null | undefined) => (value ? value.replace(/\D/g, '').slice(-9) : '');

/** First-name spellings Romanian documents use interchangeably. */
const VARIANTS: Record<string, string> = { ioan: 'ion', george: 'gheorghe', mihail: 'mihai', nicu: 'nicolae', costel: 'constantin' };
const canonical = (word: string) => VARIANTS[word] ?? word;

/** Names that are probably the same person: "Stan Mihai" and "Mihail Stan", "Popescu Ion" and "Ioan Popescu". */
export function similarNames(a: string, b: string) {
  const left = nameKey(a).split(' ').map(canonical); const right = nameKey(b).split(' ').map(canonical);
  if (!left[0] || !right[0] || nameKey(a) === nameKey(b)) return false;
  if ([...left].sort().join(' ') === [...right].sort().join(' ')) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 2) return false;
  const used = new Set<number>();
  return short.every((word) => {
    const index = long.findIndex((other, position) => !used.has(position) && (other === word || (Math.min(other.length, word.length) >= 4 && (other.startsWith(word) || word.startsWith(other)))));
    if (index < 0) return false;
    used.add(index); return true;
  });
}

/** "ION POPESCU" becomes "Ion Popescu"; names already in mixed case are kept as they are. */
export function displayName(name: string) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean !== clean.toUpperCase() && clean !== clean.toLowerCase()) return clean;
  return clean.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}

/** Creates a driver from what the platform files tell about them, merging identities the user marked as the same person. */
export async function createDriverFromIdentities(identities: DriverIdentity[]) {
  const first = identities[0];
  const pick = <K extends 'email' | 'phone'>(key: K) => identities.find((identity) => identity[key])?.[key] ?? null;
  const id = await createDriver({
    fullName: displayName(first.name), phone: pick('phone'), email: pick('email'), licenseNumber: null, notes: null, active: true,
    weeklyRent: null, commissionRate: null, iban: null,
    boltDriverId: identities.find((identity) => identity.platform === 'bolt' && identity.platformId)?.platformId ?? null,
    uberDriverId: identities.find((identity) => identity.platform === 'uber' && identity.platformId)?.platformId ?? null,
    billing: { name: null, taxId: null, regNo: null, address: null, city: null, county: null },
  });
  await rememberPlatformNames({ id, platformNames: [] }, identities.map((identity) => identity.name));
  return id;
}

/** Learns the platform id and spelling of a matched driver, so the next import recognises them by id. */
export async function learnIdentity(driver: Driver, identity: DriverIdentity) {
  const field = identity.platform === 'bolt' ? 'bolt_driver_id' : 'uber_driver_id';
  const current = identity.platform === 'bolt' ? driver.boltDriverId : driver.uberDriverId;
  if (identity.platformId && !current) expectOk(await supabase.from('drivers').update({ [field]: identity.platformId }).eq('id', driver.id), 'Saving driver');
  if (nameKey(identity.name) !== nameKey(driver.fullName)) await rememberPlatformNames(driver, [identity.name]);
}

// ---------------------------------------------------------------------------------------------------------------
// Import log: lets the app say "this exact file was imported on 24 Nov".

export type ImportRecord = {
  id: number; platform: Platform; kind: 'earnings' | 'invoices'; weekStart: string | null; fileName: string; fileHash: string;
  rowsTotal: number; rowsImported: number; rowsDuplicate: number; rowsIssues: number; createdAt: string;
};
type ImportRow = { id: number; platform: string; kind: string; week_start: string | null; file_name: string; file_hash: string; rows_total: number; rows_imported: number; rows_duplicate: number; rows_issues: number; created_at: string };
const IMPORT_COLUMNS = 'id, platform, kind, week_start, file_name, file_hash, rows_total, rows_imported, rows_duplicate, rows_issues, created_at';
const mapImport = (row: ImportRow): ImportRecord => ({
  id: row.id, platform: row.platform === 'uber' ? 'uber' : 'bolt', kind: row.kind === 'invoices' ? 'invoices' : 'earnings', weekStart: row.week_start,
  fileName: row.file_name, fileHash: row.file_hash, rowsTotal: row.rows_total, rowsImported: row.rows_imported, rowsDuplicate: row.rows_duplicate,
  rowsIssues: row.rows_issues, createdAt: row.created_at,
});
export async function getImportsByHash(hashes: string[]) {
  if (!hashes.length) return [];
  return unwrapList(await supabase.from('platform_imports').select(IMPORT_COLUMNS).in('file_hash', hashes).order('created_at', { ascending: false }).returns<ImportRow[]>(), 'Loading imports').map(mapImport);
}
export async function getRecentImports(limit = 12) {
  return unwrapList(await supabase.from('platform_imports').select(IMPORT_COLUMNS).order('created_at', { ascending: false }).limit(limit).returns<ImportRow[]>(), 'Loading imports').map(mapImport);
}
export async function createImport(input: Omit<ImportRecord, 'id' | 'createdAt'>) {
  return unwrap(await supabase.from('platform_imports').insert({
    platform: input.platform, kind: input.kind, week_start: input.weekStart, file_name: input.fileName.slice(0, 250), file_hash: input.fileHash,
    rows_total: input.rowsTotal, rows_imported: input.rowsImported, rows_duplicate: input.rowsDuplicate, rows_issues: input.rowsIssues,
  }).select('id').single<{ id: number }>(), 'Saving import').id;
}

// ---------------------------------------------------------------------------------------------------------------
// Platform earnings: one row per driver, platform and week; a re-import replaces it.

export type PlatformEarning = {
  driverId: number; platform: Platform; weekStart: string; currency: Currency; platformDriverId: string | null; platformName: string;
  gross: number; earnings: number; cash: number; tips: number; platformFees: number; bonuses: number;
};
type EarningRow = { driver_id: number; platform: string; week_start: string; currency: string; platform_driver_id: string | null; platform_name: string; gross: number; earnings: number; cash: number; tips: number; platform_fees: number; bonuses: number };
const EARNING_COLUMNS = 'driver_id, platform, week_start, currency, platform_driver_id, platform_name, gross, earnings, cash, tips, platform_fees, bonuses';
export async function getPlatformEarnings(weekStart: string) {
  const rows = unwrapList(await supabase.from('platform_earnings').select(EARNING_COLUMNS).eq('week_start', weekStart).returns<EarningRow[]>(), 'Loading earnings');
  return rows.map((row): PlatformEarning => ({
    driverId: row.driver_id, platform: row.platform === 'uber' ? 'uber' : 'bolt', weekStart: row.week_start, currency: row.currency === 'EUR' ? 'EUR' : 'RON',
    platformDriverId: row.platform_driver_id, platformName: row.platform_name, gross: row.gross, earnings: row.earnings, cash: row.cash, tips: row.tips,
    platformFees: row.platform_fees, bonuses: row.bonuses,
  }));
}
export async function saveEarnings(rows: { driverId: number; row: EarningsRow }[], weekStart: string, currency: Currency, importId: number) {
  if (!rows.length) return;
  expectOk(await supabase.from('platform_earnings').upsert(rows.map(({ driverId, row }) => ({
    driver_id: driverId, platform: row.platform, week_start: weekStart, currency, platform_driver_id: row.platformId, platform_name: row.name,
    gross: row.gross, earnings: row.earnings, cash: row.cash, tips: row.tips, platform_fees: row.platformFees, bonuses: row.bonuses, import_id: importId,
  })), { onConflict: 'user_id,driver_id,platform,week_start' }), 'Saving earnings');
}

// ---------------------------------------------------------------------------------------------------------------
// Ride invoices.

export type StoredRideInvoice = {
  id: number; platform: Platform; number: string; issuedOn: string; rideAt: string | null; weekStart: string; driverId: number | null; driverName: string;
  riderName: string | null; pickup: string | null; net: number; vat: number; total: number; currency: Currency; paymentMethod: PaymentMethod | null;
  filePath: string | null; fileUrl: string | null;
};
type RideInvoiceRow = {
  id: number; platform: string; invoice_number: string; issued_on: string; ride_at: string | null; week_start: string; driver_id: number | null; driver_name: string;
  rider_name: string | null; pickup: string | null; amount_net: number | string; vat: number | string; amount_total: number | string; currency: string; payment_method: string | null; file_path: string | null;
};
const RIDE_COLUMNS = 'id, platform, invoice_number, issued_on, ride_at, week_start, driver_id, driver_name, rider_name, pickup, amount_net, vat, amount_total, currency, payment_method, file_path';

/** Which of these invoice numbers are already stored (any week). */
export async function existingInvoiceNumbers(platform: Platform, numbers: string[]) {
  const found = new Set<string>();
  for (let index = 0; index < numbers.length; index += 300) {
    const chunk = numbers.slice(index, index + 300);
    const rows = unwrapList(await supabase.from('ride_invoices').select('invoice_number').eq('platform', platform).in('invoice_number', chunk).returns<{ invoice_number: string }[]>(), 'Checking invoices');
    rows.forEach((row) => found.add(row.invoice_number));
  }
  return found;
}

export async function getRideInvoices(filter: { from: string; to: string; driverId?: number; withFiles?: boolean }) {
  const rows: RideInvoiceRow[] = [];
  // Paged: a busy fleet issues thousands of ride invoices a month.
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from('ride_invoices').select(RIDE_COLUMNS).gte('week_start', mondayOf(filter.from)).lte('week_start', filter.to).order('ride_at', { ascending: true, nullsFirst: true }).order('id').range(offset, offset + 999);
    if (filter.driverId !== undefined) query = query.eq('driver_id', filter.driverId);
    const page = unwrapList(await query.returns<RideInvoiceRow[]>(), 'Loading ride invoices');
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const urls = filter.withFiles ? await signedUrlMap(RIDE_INVOICE_BUCKET, rows.map((row) => row.file_path)) : new Map<string, string>();
  return rows.map((row): StoredRideInvoice => ({
    id: row.id, platform: row.platform === 'uber' ? 'uber' : 'bolt', number: row.invoice_number, issuedOn: row.issued_on, rideAt: row.ride_at, weekStart: row.week_start,
    driverId: row.driver_id, driverName: row.driver_name, riderName: row.rider_name, pickup: row.pickup, net: Number(row.amount_net), vat: Number(row.vat),
    total: Number(row.amount_total), currency: row.currency === 'EUR' ? 'EUR' : 'RON', paymentMethod: row.payment_method === 'cash' || row.payment_method === 'app' ? row.payment_method : null,
    filePath: row.file_path, fileUrl: row.file_path ? urls.get(row.file_path) ?? null : null,
  }));
}

const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

/** Stores the original PDFs (when there are any) and the invoices. Numbers already stored are skipped, never duplicated. */
export async function saveRideInvoices(invoices: { invoice: RideInvoice; driverId: number | null; weekStart: string }[], importId: number, onProgress?: (done: number, total: number) => void) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('You must be signed in to upload files.');
  const uid = data.user.id;
  const paths = new Map<string, string>();
  const withFiles = invoices.filter(({ invoice }) => invoice.pdf);
  let done = 0;
  const total = withFiles.length + invoices.length;
  // A few uploads at a time: fast enough for hundreds of small PDFs without tripping rate limits.
  const queue = [...withFiles];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const path = `${uid}/ride-invoices/${next.invoice.platform}/${safeName(next.invoice.number)}.pdf`;
      const { error } = await supabase.storage.from(RIDE_INVOICE_BUCKET).upload(path, new Blob([next.invoice.pdf! as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      paths.set(`${next.invoice.platform}:${next.invoice.number}`, path);
      onProgress?.(++done, total);
    }
  }));
  for (let index = 0; index < invoices.length; index += 250) {
    const chunk = invoices.slice(index, index + 250);
    expectOk(await supabase.from('ride_invoices').upsert(chunk.map(({ invoice, driverId, weekStart }) => ({
      platform: invoice.platform, invoice_number: invoice.number, issued_on: invoice.issuedOn, ride_at: invoice.rideAt, week_start: weekStart,
      driver_id: driverId, driver_name: invoice.driverName, rider_name: invoice.riderName, pickup: invoice.pickup,
      amount_net: invoice.net, vat: invoice.vat, amount_total: invoice.total, currency: invoice.currency, payment_method: invoice.paymentMethod,
      file_path: paths.get(`${invoice.platform}:${invoice.number}`) ?? null, import_id: importId,
    })), { onConflict: 'user_id,platform,invoice_number', ignoreDuplicates: true }), 'Saving ride invoices');
    done += chunk.length; onProgress?.(done, total);
  }
}

export async function deleteRideInvoice(invoice: Pick<StoredRideInvoice, 'id' | 'filePath'>) {
  expectOk(await supabase.from('ride_invoices').delete().eq('id', invoice.id), 'Deleting invoice');
  await removeObject(RIDE_INVOICE_BUCKET, invoice.filePath);
}

/** Per driver and platform: rides, invoiced total and the part paid in cash. */
export function invoiceTotals(invoices: Pick<StoredRideInvoice | RideInvoice, 'platform' | 'total' | 'paymentMethod'>[]) {
  return invoices.reduce((sum, invoice) => ({
    count: sum.count + 1, total: sum.total + invoice.total,
    cash: sum.cash + (invoice.paymentMethod === 'cash' ? invoice.total : 0),
    knownMethod: sum.knownMethod || invoice.paymentMethod !== null,
  }), { count: 0, total: 0, cash: 0, knownMethod: false });
}
