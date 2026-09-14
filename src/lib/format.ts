import type { Currency } from './database';

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

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'The email or password is incorrect.';
  if (normalized.includes('email not confirmed')) return 'Confirm your email address before signing in.';
  if (normalized.includes('user already registered')) return 'An account already exists for this email address.';
  if (normalized.includes('rate limit')) return 'Too many attempts. Wait a moment and try again.';
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'The service could not be reached. Check your connection and try again.';
  return message;
}
