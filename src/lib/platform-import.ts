// Turns Bolt Fleet and Uber Fleet earnings exports (CSV) into per-driver weekly totals.
// Export layouts differ by platform, language and version, so columns are guessed and can be changed by the user.

export type Platform = 'bolt' | 'uber';
export type CsvTable = { headers: string[]; rows: string[][] };

/** RFC 4180-style parser with delimiter detection (comma, semicolon or tab). */
export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map((value) => ({ value, count: firstLine.split(value).length })).sort((a, b) => b.count - a.count)[0].value;
  const records: string[][] = [];
  let field = ''; let record: string[] = []; let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { record.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      record.push(field); records.push(record); record = []; field = '';
    } else field += char;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((header) => header.trim()), rows };
}

/** Parses amounts like "1.234,56", "1,234.56", "-12,5 RON" or "€ 40". Empty or unreadable cells count as 0. */
export function parseAmount(raw: string | undefined) {
  if (!raw) return 0;
  let value = raw.replace(/[^\d,.\-−]/g, '').replace('−', '-');
  const lastComma = value.lastIndexOf(','); const lastDot = value.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    value = lastComma > lastDot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A single comma followed by 1-2 digits is a decimal separator; otherwise it groups thousands.
    value = /,\d{1,2}$/.test(value) && value.split(',').length === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if ((value.match(/\./g) ?? []).length > 1) value = value.replace(/\./g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ColumnMapping = {
  /** Full-name column, or first + last name columns (Uber exports split the name). */
  name: number | null; firstName: number | null; lastName: number | null;
  /** What the platform owes the fleet for the driver's work, before the fleet's own deductions. */
  earnings: number | null;
  /** Cash the driver collected from riders and already holds; deducted from their payout. */
  cash: number | null;
};

const normalizeHeader = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function find(headers: string[], patterns: RegExp[], exclude?: RegExp) {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(normalizeHeader(header)) && !(exclude && exclude.test(normalizeHeader(header))));
    if (index > -1) return index;
  }
  return null;
}

/** Best guess of the columns in a Bolt or Uber driver earnings export. */
export function guessMapping(headers: string[]): ColumnMapping {
  const firstName = find(headers, [/first ?name|prenume/]);
  const lastName = find(headers, [/surname|last ?name|nume de familie/]);
  const name = firstName !== null && lastName !== null ? null
    : find(headers, [/^driver$|^sofer$|^driver name|^nume sofer|^numele soferului/, /driver|sofer|^name$|^nume$/], /phone|telefon|id$|uuid|email|first|last|surname/);
  const earnings = find(headers, [
    /net earnings|castig(uri)? net|venit net/,
    /total earnings|your earnings|castig(uri)? total/,
    /payout|plata/,
    /earnings|castig|venit/,
  ], /cash|numerar|tip|bacsis|bonus|fee|comision|gross \(/);
  const cash = find(headers, [/cash in hand|cash collected|numerar incasat|bani cash/, /cash|numerar/], /gross|brut|earnings \(cash\)/);
  return { name, firstName, lastName, earnings, cash };
}

export type PlatformTotal = { name: string; earnings: number; cash: number; rows: number };

/** Sums the export per driver name (exports may have one row per day or per payment). */
export function totalsByDriver(table: CsvTable, mapping: ColumnMapping): PlatformTotal[] {
  const totals = new Map<string, PlatformTotal>();
  table.rows.forEach((row) => {
    const name = (mapping.name !== null ? row[mapping.name] : [mapping.firstName, mapping.lastName].map((index) => (index === null ? '' : row[index] ?? '')).join(' ')).replace(/\s+/g, ' ').trim();
    if (!name || /^(total|totaluri?|sum)$/i.test(name)) return;
    const key = nameKey(name);
    const current = totals.get(key) ?? { name, earnings: 0, cash: 0, rows: 0 };
    current.earnings += mapping.earnings === null ? 0 : parseAmount(row[mapping.earnings]);
    current.cash += mapping.cash === null ? 0 : Math.abs(parseAmount(row[mapping.cash]));
    current.rows += 1;
    totals.set(key, current);
  });
  return [...totals.values()].map((total) => ({ ...total, earnings: round(total.earnings), cash: round(total.cash) }));
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Order-, case- and diacritic-insensitive key: "Popescu Alexandru" matches "ALEXANDRU POPESCU" and "Alexandru Popescu". */
export function nameKey(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean).sort().join(' ');
}

/** Finds the driver for a platform name: exact learned alias first, then the same name in any order. */
export function matchDriver<T extends { id: number; fullName: string; platformNames: string[] }>(name: string, drivers: T[]) {
  const key = nameKey(name);
  return drivers.find((driver) => driver.platformNames.some((alias) => nameKey(alias) === key))
    ?? drivers.find((driver) => nameKey(driver.fullName) === key)
    ?? null;
}

/** Remembers each export layout's chosen columns in this browser, keyed by its header row. */
const mappingKey = (platform: Platform, headers: string[]) => `vehix.import.${platform}.${headers.join('|').slice(0, 400)}`;
export function savedMapping(platform: Platform, headers: string[]): ColumnMapping | null {
  try { const value = localStorage.getItem(mappingKey(platform, headers)); return value ? JSON.parse(value) as ColumnMapping : null; } catch { return null; }
}
export function saveMapping(platform: Platform, headers: string[], mapping: ColumnMapping) {
  try { localStorage.setItem(mappingKey(platform, headers), JSON.stringify(mapping)); } catch { /* storage unavailable: the guess is used next time */ }
}
