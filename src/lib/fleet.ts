import type { StringKey } from '@/i18n/strings';
import type { Car, ComplianceKind, FuelUse, ServicePlan, Trip } from './database';
import { addDays, daysUntil, today } from './format';

// Documents ---------------------------------------------------------------

export type DriverDocumentKind = 'license' | 'arr_certificate' | 'medical' | 'psychological' | 'criminal_record';
export const DRIVER_DOCUMENT_KINDS: DriverDocumentKind[] = ['license', 'arr_certificate', 'medical', 'psychological', 'criminal_record'];

/** Validity presets offered when a document is added; months unless `days` is set. */
export type Validity = { months?: number; days?: number };

type DocumentMeta = { label: StringKey; icon: string; validity: Validity[] };
export const CAR_DOCUMENTS: Record<ComplianceKind, DocumentMeta> = {
  itp: { label: 'docItp', icon: 'bi-clipboard2-check', validity: [{ months: 6 }, { months: 12 }, { months: 24 }] },
  rca: { label: 'docRca', icon: 'bi-shield-check', validity: [{ months: 6 }, { months: 12 }] },
  vignette: { label: 'docVignette', icon: 'bi-sign-turn-right', validity: [{ days: 30 }, { days: 90 }, { months: 12 }] },
  passenger_insurance: { label: 'docPassengerInsurance', icon: 'bi-people', validity: [{ months: 12 }] },
  arr_copy: { label: 'docArrCopy', icon: 'bi-file-earmark-check', validity: [{ months: 12 }, { months: 24 }, { months: 36 }] },
  badge: { label: 'docBadge', icon: 'bi-person-badge', validity: [{ months: 12 }, { months: 24 }, { months: 36 }] },
  casco: { label: 'docCasco', icon: 'bi-shield-plus', validity: [{ months: 12 }] },
};
export const DRIVER_DOCUMENTS: Record<DriverDocumentKind, DocumentMeta> = {
  license: { label: 'docLicense', icon: 'bi-person-vcard', validity: [{ months: 120 }] },
  arr_certificate: { label: 'docArrCertificate', icon: 'bi-award', validity: [{ months: 60 }] },
  medical: { label: 'docMedical', icon: 'bi-heart-pulse', validity: [{ months: 12 }, { months: 24 }] },
  psychological: { label: 'docPsychological', icon: 'bi-person-check', validity: [{ months: 12 }, { months: 24 }] },
  criminal_record: { label: 'docCriminalRecord', icon: 'bi-file-earmark-lock', validity: [{ months: 6 }] },
};

/** Documents every car needs, plus the ride-sharing set (OUG 49/2019) for cars rented to Bolt/Uber drivers. */
export function requiredCarDocuments(car: Pick<Car, 'ridesharing'>): ComplianceKind[] {
  return car.ridesharing ? ['itp', 'rca', 'vignette', 'passenger_insurance', 'arr_copy', 'badge'] : ['itp', 'rca', 'vignette'];
}
export const optionalCarDocuments = (car: Pick<Car, 'ridesharing'>) =>
  (Object.keys(CAR_DOCUMENTS) as ComplianceKind[]).filter((kind) => !requiredCarDocuments(car).includes(kind));

/** Default validity when a document is added: ride-sharing cars need ITP every 6 months. */
export function defaultValidity(kind: ComplianceKind | DriverDocumentKind, ridesharing = false): Validity {
  if (kind === 'itp') return { months: ridesharing ? 6 : 24 };
  if (kind in CAR_DOCUMENTS) return CAR_DOCUMENTS[kind as ComplianceKind].validity.at(-1)!;
  return DRIVER_DOCUMENTS[kind as DriverDocumentKind].validity[0];
}

export function addMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}
/** Last valid day for a document issued on `issued`: valid through the day before the anniversary. */
export const expiryFor = (issued: string, validity: Validity) => addDays(validity.days ? addDays(issued, validity.days) : addMonths(issued, validity.months ?? 12), -1);

export type DocumentState = 'missing' | 'expired' | 'soon' | 'valid';
/** Ride-sharing documents get a 14-day warning; a lapse takes the car off the road. */
export const WARNING_DAYS = 14;
export function documentState(expiresDate: string | null | undefined): DocumentState {
  if (!expiresDate) return 'missing';
  const days = daysUntil(expiresDate);
  return days < 0 ? 'expired' : days <= WARNING_DAYS ? 'soon' : 'valid';
}

// Service plans -----------------------------------------------------------

export type ServiceTemplate = { title: StringKey; intervalKm: number | null; intervalMonths: number | null };
export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  { title: 'templateOil', intervalKm: 15000, intervalMonths: 12 },
  { title: 'templateBrakes', intervalKm: 30000, intervalMonths: 12 },
  { title: 'templateTyres', intervalKm: 10000, intervalMonths: null },
  { title: 'templateFilters', intervalKm: 15000, intervalMonths: 12 },
  { title: 'templateTimingBelt', intervalKm: 120000, intervalMonths: 60 },
];

/** Km a car drives per day, from its done trips in the last 8 weeks; null when there is too little data. */
export const RATE_WINDOW_DAYS = 56;
export function dailyKm(trips: Trip[], carId: number) {
  const since = addDays(today(), -RATE_WINDOW_DAYS);
  const km = trips.filter((trip) => trip.carId === carId && trip.status === 'done' && trip.date >= since).reduce((sum, trip) => sum + trip.distance, 0);
  return km >= 100 ? km / RATE_WINDOW_DAYS : null;
}

/** Today's odometer: the last reading plus what the car has likely driven since. */
export function estimatedMileage(car: Pick<Car, 'mileageKm' | 'mileageUpdatedOn'>, rate: number | null) {
  if (car.mileageKm === null) return null;
  const days = Math.max(0, -daysUntil(car.mileageUpdatedOn));
  return Math.round(car.mileageKm + (rate ?? 0) * days);
}

export type ServiceDue = {
  state: 'unknown' | 'overdue' | 'soon' | 'ok';
  /** Km left until due (negative when overdue), when the plan has a km interval and a known odometer. */
  kmLeft: number | null;
  /** Projected due date: the earlier of the time limit and when the km limit is reached at the current rate. */
  dueDate: string | null;
};
export const SERVICE_SOON_DAYS = 14;
export const SERVICE_SOON_KM = 1000;

export function serviceDue(plan: ServicePlan, mileage: number | null, rate: number | null): ServiceDue {
  if (!plan.lastDoneOn && plan.lastDoneKm === null) return { state: 'unknown', kmLeft: null, dueDate: null };
  const kmLeft = plan.intervalKm !== null && plan.lastDoneKm !== null && mileage !== null ? plan.lastDoneKm + plan.intervalKm - mileage : null;
  const byTime = plan.intervalMonths !== null && plan.lastDoneOn ? addMonths(plan.lastDoneOn, plan.intervalMonths) : null;
  const byKm = kmLeft !== null && rate ? addDays(today(), Math.floor(kmLeft / rate)) : null;
  const dueDate = [byTime, byKm].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const days = dueDate ? daysUntil(dueDate) : null;
  const state = (kmLeft !== null && kmLeft <= 0) || (days !== null && days < 0) ? 'overdue'
    : (kmLeft !== null && kmLeft <= SERVICE_SOON_KM) || (days !== null && days <= SERVICE_SOON_DAYS) ? 'soon' : 'ok';
  return { state, kmLeft, dueDate };
}

// Fuel --------------------------------------------------------------------

/** Flag a driver when their L/100 km on a car is this much above the car's own baseline, over enough distance. */
export const FUEL_ALERT_RATIO = 0.1;
export const FUEL_ALERT_MIN_KM = 300;
export type FuelAlert = FuelUse & { deviation: number };
export function fuelAlerts(rows: FuelUse[]): FuelAlert[] {
  return rows
    .filter((row) => row.consumption !== null && row.baseline !== null && row.baseline > 0 && row.distance >= FUEL_ALERT_MIN_KM)
    .map((row) => ({ ...row, deviation: row.consumption! / row.baseline! - 1 }))
    .filter((row) => row.deviation >= FUEL_ALERT_RATIO)
    .sort((a, b) => b.deviation - a.deviation);
}

export const carLabel = (car: Pick<Car, 'brand' | 'model'> & Partial<Pick<Car, 'plateNumber'>>) => `${car.brand} ${car.model}${car.plateNumber ? ` · ${car.plateNumber}` : ''}`;
