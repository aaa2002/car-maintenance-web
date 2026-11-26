// Recognises and reads the files fleets download from Bolt and Uber: weekly driver earnings (CSV), the Bolt ride
// invoice register (CSV) and Uber ride invoices (a ZIP of PDFs, one folder per driver, or loose PDFs).
// Everything is parsed in the browser; nothing is sent anywhere until the user confirms the import.
import { addDays, mondayOf } from './format';
import { parseAmount, parseCsv, type CsvTable, type Platform } from './platform-import';

export type DriverIdentity = { platform: Platform; platformId: string | null; name: string; email: string | null; phone: string | null };

export type EarningsRow = DriverIdentity & {
  /** What the platform credits the fleet for the driver's week, after the platform's own fee. May be negative (refunds). */
  earnings: number;
  /** Cash the driver collected from riders and still holds. */
  cash: number;
  gross: number; tips: number; platformFees: number; bonuses: number;
};
export type EarningsFile = {
  kind: 'earnings'; platform: Platform; fileName: string; hash: string; weekStart: string | null;
  rows: EarningsRow[];
  /** Rows that are not drivers (the fleet's own account, totals) or have no activity. */
  ignored: { name: string; reason: 'noActivity' | 'total' }[];
};

export type PaymentMethod = 'cash' | 'app';
export type RideInvoice = {
  platform: Platform; number: string; issuedOn: string; rideAt: string | null; driverName: string;
  riderName: string | null; pickup: string | null; net: number; vat: number; total: number; currency: 'RON' | 'EUR';
  paymentMethod: PaymentMethod | null;
  /** Where the invoice came from: CSV row or path inside the ZIP. */
  source: string;
  pdf?: Uint8Array;
};
export type InvoiceIssueReason = 'unreadable' | 'notPdf' | 'notRideInvoice' | 'missingNumber' | 'missingAmount' | 'missingDate' | 'missingDriver' | 'duplicateInFile' | 'currency';
export type InvoiceIssue = { source: string; reason: InvoiceIssueReason; number?: string };
/** Company details printed on the ride invoices, offered to fill in the invoicing profile. */
export type CompanyHint = { name: string; address: string | null; taxId: string | null; vatNumber: string | null; regNo: string | null };
export type InvoiceFile = {
  kind: 'invoices'; platform: Platform; fileName: string; hash: string;
  invoices: RideInvoice[]; issues: InvoiceIssue[]; company: CompanyHint | null;
};
export type UnknownFile = { kind: 'unknown'; fileName: string; hash: string; reason: 'unsupported' | 'empty' | 'unrecognised' };
export type ParsedFile = EarningsFile | InvoiceFile | UnknownFile;

/** Reads a PDF's text; injected so the parsing below can be tested without a browser. */
export type PdfTextReader = (data: Uint8Array) => Promise<string>;

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const round = (value: number) => Math.round(value * 100) / 100;

export async function sha256(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Week detection from file names: Bolt uses ISO weeks ("2026W47"), Uber a date range ("20261116-20261123").

/** Monday of ISO week `week` in `year`. */
export function isoWeekMonday(year: number, week: number) {
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

export function weekFromFileName(name: string): string | null {
  const iso = name.match(/(20\d{2})[-_ ]?W(\d{1,2})(?!\d)/i);
  if (iso) { const week = Number(iso[2]); if (week >= 1 && week <= 53) return isoWeekMonday(Number(iso[1]), week); }
  const range = name.match(/(20\d{2})(\d{2})(\d{2})-(20\d{2})(\d{2})(\d{2})/);
  if (range) return mondayOf(`${range[1]}-${range[2]}-${range[3]}`);
  const day = name.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return day ? mondayOf(`${day[1]}-${day[2]}-${day[3]}`) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV layouts. Headers come in Romanian or English, with diacritics or not, and with a "|LEI" unit suffix (Bolt).

function column(headers: string[], patterns: RegExp[], exclude?: RegExp) {
  const clean = headers.map((header) => normalize(header).replace(/\|.*$/, '').trim());
  for (const pattern of patterns) {
    const index = clean.findIndex((header) => pattern.test(header) && !(exclude && exclude.test(header)));
    if (index > -1) return index;
  }
  return null;
}
const cell = (row: string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());
const amount = (row: string[], index: number | null) => (index === null ? 0 : parseAmount(row[index]));

function isBoltEarnings(headers: string[]) {
  return column(headers, [/^castiguri nete$/, /^net earnings$/]) !== null && column(headers, [/^sofer$/, /^driver$/]) !== null;
}
function isUberEarnings(headers: string[]) {
  return column(headers, [/^prenumele soferului$/, /^driver first name$/]) !== null && column(headers, [/castigurile tale$/, /your earnings$/]) !== null;
}
function isBoltInvoices(headers: string[]) {
  return column(headers, [/^factura numarul$/, /^invoice number$/]) !== null && column(headers, [/^nume sofer$/, /^driver name$/]) !== null;
}

function boltEarnings(table: CsvTable) {
  const h = table.headers;
  const at = {
    name: column(h, [/^sofer$/, /^driver$/]), email: column(h, [/^e-?mail$/]), phone: column(h, [/^telefon$/, /^phone$/]),
    id: column(h, [/^identificatorul soferului$/, /^driver('s)? (uu)?id$/]),
    gross: column(h, [/^castiguri brute \(total\)$/, /^gross earnings \(total\)$/]),
    earnings: column(h, [/^castiguri nete$/, /^net earnings$/]),
    cash: column(h, [/^numerar incasat$/, /^cash collected$/]),
    tips: column(h, [/^bacsis/, /^tips?\b/]),
    fees: column(h, [/^comisioane$/, /^commissions?$/]),
    bonuses: column(h, [/^castiguri din campanii$/, /^campaign earnings$/]),
  };
  return table.rows.map((row) => ({
    identity: { platform: 'bolt' as const, platformId: cell(row, at.id) || null, name: cell(row, at.name), email: cell(row, at.email).toLowerCase() || null, phone: normalizePhone(cell(row, at.phone)) },
    earnings: amount(row, at.earnings), cash: Math.abs(amount(row, at.cash)), gross: amount(row, at.gross),
    tips: amount(row, at.tips), platformFees: Math.abs(amount(row, at.fees)), bonuses: amount(row, at.bonuses),
  }));
}

function uberEarnings(table: CsvTable) {
  const h = table.headers;
  // Uber nests columns as "Paid to you : Your earnings : Fare : ..."; the exact "… : Your earnings" column is the driver's total.
  const at = {
    id: column(h, [/(uuid|identificatorul universal unic)/]),
    first: column(h, [/^prenumele soferului$/, /^driver first name$/]), last: column(h, [/^numele de familie al soferului$/, /^driver surname$|^driver last name$/]),
    earnings: column(h, [/^castiguri primite ?: ?castigurile tale$/, /^paid to you ?: ?your earnings$/]),
    cash: column(h, [/numerar incasat$/, /cash collected$/]),
    gross: column(h, [/^castiguri primite ?: ?castigurile tale ?: ?tarif$/, /^paid to you ?: ?your earnings ?: ?fare$/]),
    fees: column(h, [/castigurile tale ?: ?taxa de servicii$/, /your earnings ?: ?service fee$/]),
    tips: column(h, [/castigurile tale ?: ?bacsis$/, /your earnings ?: ?tip$/]),
  };
  const promotions = h.map((header, index) => ({ header: normalize(header), index })).filter(({ header }) => /(promotie|promotion|recompensa|reward)/.test(header)).map(({ index }) => index);
  return table.rows.map((row) => ({
    identity: { platform: 'uber' as const, platformId: cell(row, at.id) || null, name: `${cell(row, at.first)} ${cell(row, at.last)}`.replace(/\s+/g, ' ').trim(), email: null, phone: null },
    earnings: amount(row, at.earnings), cash: Math.abs(amount(row, at.cash)), gross: amount(row, at.gross),
    tips: amount(row, at.tips), platformFees: Math.abs(amount(row, at.fees)), bonuses: promotions.reduce((sum, index) => sum + amount(row, index), 0),
  }));
}

export function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('07') && digits.length === 10) return `+4${digits}`;
  return digits;
}

type ParsedEarnings = { identity: DriverIdentity; earnings: number; cash: number; gross: number; tips: number; platformFees: number; bonuses: number };
function earningsFile(platform: Platform, fileName: string, hash: string, parsed: ParsedEarnings[]): EarningsFile {
  const rows: EarningsRow[] = []; const ignored: EarningsFile['ignored'] = [];
  // A driver can appear on several rows (per day or per payment); sum them by platform id or name.
  const byKey = new Map<string, EarningsRow>();
  parsed.forEach(({ identity, ...figures }) => {
    if (!identity.name || /^(total|totaluri?|sum)$/i.test(identity.name)) { if (identity.name) ignored.push({ name: identity.name, reason: 'total' }); return; }
    if (Math.abs(figures.earnings) < 0.005 && figures.cash < 0.005 && Math.abs(figures.gross) < 0.005) { ignored.push({ name: identity.name, reason: 'noActivity' }); return; }
    const key = identity.platformId ?? normalize(identity.name);
    const current = byKey.get(key);
    if (!current) { const row = { ...identity, ...figures }; byKey.set(key, row); rows.push(row); return; }
    current.earnings += figures.earnings; current.cash += figures.cash; current.gross += figures.gross;
    current.tips += figures.tips; current.platformFees += figures.platformFees; current.bonuses += figures.bonuses;
  });
  rows.forEach((row) => { row.earnings = round(row.earnings); row.cash = round(row.cash); row.gross = round(row.gross); row.tips = round(row.tips); row.platformFees = round(row.platformFees); row.bonuses = round(row.bonuses); });
  return { kind: 'earnings', platform, fileName, hash, weekStart: weekFromFileName(fileName), rows, ignored };
}

// ---------------------------------------------------------------------------------------------------------------
// Ride invoices.

/** "2026-11-24 18:09:18", "24.11.2026" or "24.11.2026 18:09" to ISO; null when unreadable. */
export function parseDateTime(value: string): { date: string; time: string | null } | null {
  const iso = value.match(/(20\d{2})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, time: iso[4] ? `${iso[4]}:${iso[5]}:${iso[6] ?? '00'}` : null };
  const ro = value.match(/(\d{1,2})[./](\d{1,2})[./](20\d{2})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (ro) return { date: `${ro[3]}-${ro[2].padStart(2, '0')}-${ro[1].padStart(2, '0')}`, time: ro[4] ? `${ro[4]}:${ro[5]}:${ro[6] ?? '00'}` : null };
  return null;
}
const validDate = (date: string) => { const [y, m, d] = date.split('-').map(Number); const parsed = new Date(y, m - 1, d); return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d; };

function boltInvoices(table: CsvTable, fileName: string, hash: string): InvoiceFile {
  const h = table.headers;
  const at = {
    number: column(h, [/^factura numarul$/, /^invoice number$/]), date: column(h, [/^data$/, /^date$/]),
    driver: column(h, [/^nume sofer$/, /^driver name$/]), pickup: column(h, [/^loc de preluare$/, /^pick-?up/]),
    rideDate: column(h, [/^data cursei$/, /^ride date$|^trip date$/]), rider: column(h, [/^beneficiar$/, /^recipient$|^customer$/]),
    vat: column(h, [/^tva$/, /^vat$/]), net: column(h, [/fara tva/, /without vat|excl/]), total: column(h, [/^pret cursa$/, /^ride price$|^trip price$|^price$/]),
    method: column(h, [/^metoda de plata$/, /^payment method$/]), currency: column(h, [/^moneda$/, /^currency$/]),
    company: column(h, [/^nume companie$/, /^company name$/]), companyAddress: column(h, [/^adresa companiei$/, /^company address$/]),
    companyTaxId: column(h, [/^cod unic de inregistrare$/, /^company registration/]), companyVat: column(h, [/^cod tva companie$/, /^company vat/]),
  };
  const invoices: RideInvoice[] = []; const issues: InvoiceIssue[] = []; const seen = new Set<string>();
  table.rows.forEach((row, index) => {
    const source = `${fileName} · ${index + 2}`;
    const number = cell(row, at.number);
    if (!number) { issues.push({ source, reason: 'missingNumber' }); return; }
    if (seen.has(number)) { issues.push({ source, reason: 'duplicateInFile', number }); return; }
    seen.add(number);
    const issued = parseDateTime(cell(row, at.date)); const ride = parseDateTime(cell(row, at.rideDate));
    if (!issued || !validDate(issued.date)) { issues.push({ source, reason: 'missingDate', number }); return; }
    const driverName = cell(row, at.driver);
    if (!driverName) { issues.push({ source, reason: 'missingDriver', number }); return; }
    const totalText = cell(row, at.total);
    if (!totalText || !/\d/.test(totalText)) { issues.push({ source, reason: 'missingAmount', number }); return; }
    const total = parseAmount(totalText); const vat = amount(row, at.vat);
    const netText = cell(row, at.net);
    const currencyText = cell(row, at.currency).toUpperCase();
    const currency = currencyText === 'EUR' ? 'EUR' : currencyText === '' || currencyText === 'RON' || currencyText === 'LEI' ? 'RON' : null;
    if (!currency) { issues.push({ source, reason: 'currency', number }); return; }
    const method = normalize(cell(row, at.method));
    invoices.push({
      platform: 'bolt', number, issuedOn: issued.date, rideAt: ride ? `${ride.date}T${ride.time ?? '00:00:00'}` : null, driverName,
      riderName: cell(row, at.rider) || null, pickup: cell(row, at.pickup) || null,
      net: round(netText ? parseAmount(netText) : total - vat), vat: round(vat), total: round(total), currency,
      paymentMethod: /cash|numerar/.test(method) ? 'cash' : method ? 'app' : null, source,
    });
  });
  const first = table.rows[0];
  const company = first && cell(first, at.company) ? {
    name: cell(first, at.company), address: cell(first, at.companyAddress) || null, taxId: cell(first, at.companyTaxId) || null,
    vatNumber: cell(first, at.companyVat) || null, regNo: null,
  } : null;
  return { kind: 'invoices', platform: 'bolt', fileName, hash, invoices, issues, company };
}

/** PDF text extraction sets some Romanian letters apart ("Bucure ș ti", "Ș tefan"); put them back into their words. */
export const joinSplitDiacritics = (text: string) => text
  .replace(/(\p{Ll}) ([șşțţăîâ]) (\p{Ll})/gu, '$1$2$3')
  .replace(/(^|\s)([ȘŞȚŢĂÎÂ]) (\p{Ll})/gmu, '$1$2$3');

/** Reads one Uber driver-to-rider invoice from its PDF text. The driver comes from the folder the ZIP put it in. */
export function parseUberInvoiceText(text: string, source: string, driverName: string | null): { invoice: RideInvoice | null; issue: InvoiceIssue | null; company: CompanyHint | null } {
  text = joinSplitDiacritics(text);
  const flat = text.replace(/\s+/g, ' ');
  const number = flat.match(/(?:Num[aă]rul facturii|Invoice number|Invoice No\.?)\s*:\s*([A-Z0-9][A-Z0-9-]{3,})/i)?.[1];
  if (!number) return { invoice: null, issue: { source, reason: /factur|invoice/i.test(flat) ? 'missingNumber' : 'unreadable' }, company: null };
  const dateText = flat.match(/(?:Data facturii|Invoice date)\s*:\s*([\d./-]{8,10})/i)?.[1];
  const issued = dateText ? parseDateTime(dateText) : null;
  if (!issued || !validDate(issued.date)) return { invoice: null, issue: { source, reason: 'missingDate', number }, company: null };
  if (!driverName) return { invoice: null, issue: { source, reason: 'missingDriver', number }, company: null };
  const amounts = [...flat.matchAll(/(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:[.,]\d{2}))\s*(RON|LEI|EUR)/gi)].map((match) => ({ value: parseAmount(match[1]), currency: match[2].toUpperCase() }));
  if (!amounts.length) return { invoice: null, issue: { source, reason: 'missingAmount', number }, company: null };
  const currencies = new Set(amounts.map((entry) => (entry.currency === 'EUR' ? 'EUR' : 'RON')));
  if (currencies.size > 1) return { invoice: null, issue: { source, reason: 'currency', number }, company: null };
  // The largest amount is the total; with VAT the net is the next one down, without VAT they are equal.
  const values = [...new Set(amounts.map((entry) => entry.value))].sort((a, b) => Math.abs(b) - Math.abs(a));
  const credit = /not[aă] de credit|credit note|storno/i.test(flat);
  const sign = credit && values[0] > 0 ? -1 : 1;
  const total = values[0] * sign;
  const net = (values.length > 1 && /TVA\s*\d|VAT\s*\d|\d+\s*%/.test(flat) ? values[1] : values[0]) * sign;
  // "UBER-2026-11-16-08-15-driver-to-rider-invoice-…": the ride's local time is in the file name.
  const stamp = source.match(/(20\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-driver-to-rider/);
  // The rider's name is the first line that is neither the document title nor a country.
  const riderName = text.split(/\r?\n/).map((line) => line.replace(/\s+(Romania|România|Moldova)\s*$/i, '').trim()).find((line) => line && !/^(factur|invoice|romania|românia)/i.test(line)) ?? null;
  const company = companyFromUberText(flat);
  return {
    invoice: {
      platform: 'uber', number, issuedOn: issued.date, rideAt: stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00` : null,
      driverName, riderName: riderName && !/[:/]/.test(riderName) ? riderName : null, pickup: null,
      net: round(net), vat: round(total - net), total: round(total), currency: currencies.has('EUR') ? 'EUR' : 'RON', paymentMethod: null, source,
    },
    issue: null, company,
  };
}

function companyFromUberText(flat: string): CompanyHint | null {
  const name = flat.match(/(?:[iî]n numele|on behalf of)\s*:\s*(.+?)\s+(?:Str\.|Strada|Bd\.|Bulevardul|Calea|Sos\.|Șos|Soseaua|CUI|$)/i)?.[1]?.trim();
  if (!name) return null;
  const address = flat.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.+?)\\s+(?:CUI|TVA|VAT)\\s*:`, 'i'))?.[1]?.trim() ?? null;
  return {
    name, address, taxId: flat.match(/CUI\s*:\s*(\d{2,10})/i)?.[1] ?? null, vatNumber: flat.match(/TVA\s*:\s*(RO\d{2,10})/i)?.[1] ?? null,
    regNo: flat.match(/(?:Trade Registry|Registrul Comer[tț]ului)\s*:\s*([JFC]\d{2}\/\d+\/\d{4}|J\d{4}\d+\w*)/i)?.[1] ?? null,
  };
}

const isRideInvoicePath = (path: string) => !/(uber-to-driver|driver-to-uber|service-fee|commission|comision)/i.test(path);
/** Folder layout in Uber's export: "<Driver name>/driver-to-rider/<file>.pdf". */
const driverFromPath = (path: string) => { const parts = path.split('/').filter(Boolean); return parts.length >= 2 ? parts[0].trim() : null; };

async function uberInvoices(entries: { path: string; data: Uint8Array }[], fileName: string, hash: string, readPdf: PdfTextReader, onProgress?: (done: number, total: number) => void): Promise<InvoiceFile> {
  const invoices: RideInvoice[] = []; const issues: InvoiceIssue[] = []; const seen = new Set<string>();
  let company: CompanyHint | null = null; let done = 0;
  const pdfs = entries.filter((entry) => !entry.path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX'));
  for (const entry of pdfs) {
    done += 1; onProgress?.(done, pdfs.length);
    if (!/\.pdf$/i.test(entry.path)) { issues.push({ source: entry.path, reason: 'notPdf' }); continue; }
    if (!isRideInvoicePath(entry.path)) { issues.push({ source: entry.path, reason: 'notRideInvoice' }); continue; }
    let text: string;
    try { text = await readPdf(entry.data); } catch { issues.push({ source: entry.path, reason: 'unreadable' }); continue; }
    const result = parseUberInvoiceText(text, entry.path, driverFromPath(entry.path));
    if (result.issue) { issues.push(result.issue); continue; }
    const invoice = result.invoice!;
    if (seen.has(invoice.number)) { issues.push({ source: entry.path, reason: 'duplicateInFile', number: invoice.number }); continue; }
    seen.add(invoice.number);
    company ??= result.company;
    invoices.push({ ...invoice, pdf: entry.data });
  }
  return { kind: 'invoices', platform: 'uber', fileName, hash, invoices, issues, company };
}

// ---------------------------------------------------------------------------------------------------------------

export type ReadOptions = { readPdf: PdfTextReader; unzip: (data: Uint8Array) => Promise<{ path: string; data: Uint8Array }[]>; onProgress?: (done: number, total: number) => void };

/** Classifies a file by content (not by name) and parses it. */
export async function readPlatformFile(name: string, data: Uint8Array, options: ReadOptions): Promise<ParsedFile> {
  const hash = await sha256(data);
  if (!data.length) return { kind: 'unknown', fileName: name, hash, reason: 'empty' };
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const isPdf = data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
  if (isZip) {
    const entries = await options.unzip(data);
    if (!entries.length) return { kind: 'unknown', fileName: name, hash, reason: 'empty' };
    return uberInvoices(entries, name, hash, options.readPdf, options.onProgress);
  }
  if (isPdf) return uberInvoices([{ path: name, data }], name, hash, options.readPdf, options.onProgress);
  if (!/\.(csv|txt)$/i.test(name) && data.slice(0, 200).some((byte) => byte === 0)) return { kind: 'unknown', fileName: name, hash, reason: 'unsupported' };
  const table = parseCsv(new TextDecoder('utf-8').decode(data));
  if (!table.headers.length) return { kind: 'unknown', fileName: name, hash, reason: 'empty' };
  if (isBoltInvoices(table.headers)) return boltInvoices(table, name, hash);
  if (isBoltEarnings(table.headers)) return earningsFile('bolt', name, hash, boltEarnings(table));
  if (isUberEarnings(table.headers)) return earningsFile('uber', name, hash, uberEarnings(table));
  return { kind: 'unknown', fileName: name, hash, reason: 'unrecognised' };
}

/** Sunday of the week starting on `weekStart`. */
export const weekEnd = (weekStart: string) => addDays(weekStart, 6);
/** The week an invoice belongs to: the ride's day when known, else the invoice date. */
export const invoiceWeek = (invoice: Pick<RideInvoice, 'rideAt' | 'issuedOn'>) => mondayOf((invoice.rideAt ?? invoice.issuedOn).slice(0, 10));
