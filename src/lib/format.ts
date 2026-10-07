import type { Currency } from './database';
import type { Language, StringKey } from '@/i18n/strings';

export function localDate(value: string, language: 'en' | 'ro' = 'en') {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}

export function money(value: number, currency: Currency, language: 'en' | 'ro' = 'en') {
  return new Intl.NumberFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function number(value: number, language: 'en' | 'ro' = 'en', digits = 1) {
  return new Intl.NumberFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { maximumFractionDigits: digits }).format(value);
}

export function dateInputValue(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function today() { return dateInputValue(); }

const parseDay = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };

export function addDays(value: string, days: number) {
  const date = parseDay(value); date.setDate(date.getDate() + days); return dateInputValue(date);
}

/** Monday of the week containing `value` (settlements are stored per ISO week). */
export function mondayOf(value: string) {
  const date = parseDay(value); const weekday = (date.getDay() + 6) % 7; date.setDate(date.getDate() - weekday); return dateInputValue(date);
}

/** First and last day (inclusive) of the month `offset` months from now, plus its label. */
export function monthRange(offset: number, language: 'en' | 'ro') {
  const { start, next } = monthBounds(offset);
  const label = new Intl.DateTimeFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { month: 'long', year: 'numeric' }).format(parseDay(start));
  return { from: start, to: addDays(next, -1), label };
}

export function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return dateInputValue(value);
}

export function daysUntil(value: string) {
  const target = new Date(`${value}T00:00:00`);
  const current = new Date(`${today()}T00:00:00`);
  return Math.round((target.getTime() - current.getTime()) / 86_400_000);
}

export function monthBounds(offset: number) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  const toDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  return { start: toDate(date), next: toDate(next), label: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date) };
}

// An error whose message is a translation key, so it re-renders in the current language.
export class AppError extends Error {
  constructor(readonly key: StringKey) { super(key); }
}

function errorKey(error: unknown): StringKey | null {
  if (error instanceof AppError) return error.key;
  if (!(error instanceof Error)) return 'genericError';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const normalized = error.message.toLowerCase();
  if (code === 'invalid_credentials' || normalized.includes('invalid login credentials')) return 'invalidCredentials';
  if (code === 'email_not_confirmed' || normalized.includes('email not confirmed')) return 'emailNotConfirmed';
  if (code === 'user_already_exists' || code === 'email_exists' || normalized.includes('user already registered')) return 'userExists';
  if (code === 'email_address_invalid' || /email address .* is invalid/.test(normalized)) return 'invalidEmail';
  if (code === 'weak_password') return 'weakPassword';
  if (code.startsWith('over_') || normalized.includes('rate limit')) return 'rateLimited';
  if (normalized.includes('vehicle_limit_reached')) return 'vehicleLimitReached';
  if (normalized.includes('vehicle_locked')) return 'vehicleLocked';
  if (normalized.includes('weekly_settlements_user_id_driver_id_week_start_key')) return 'duplicateWeek';
  if (normalized.includes('too_many_active_vehicles')) return 'tooManyActiveVehicles';
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'networkError';
  return null;
}

export function errorMessage(error: unknown, t: (key: StringKey) => string) {
  const key = errorKey(error);
  return key ? t(key) : (error as Error).message;
}

export function countLabel(count: number, language: Language, t: (key: StringKey) => string, key: 'vehicleCount' | 'attentionCount') {
  const category = new Intl.PluralRules(language).select(count);
  const form = category === 'one' ? 'One' : category === 'few' ? 'Few' : 'Other';
  return t(`${key}${form}`).replace('{n}', number(count, language, 0));
}
