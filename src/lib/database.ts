import { CAR_DOCUMENT_BUCKET, CAR_PHOTO_BUCKET, removeObject, signedUrl, signedUrlMap } from './storage';
import { expectOk, supabase, unwrap, unwrapList } from './supabase';

export type MaintenanceStatus = 'done' | 'scheduled';
export type Currency = 'RON' | 'EUR';
export type ComplianceKind = 'itp' | 'rca' | 'vignette' | 'passenger_insurance' | 'arr_copy' | 'badge' | 'casco';
export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'plugin_hybrid' | 'electric' | 'lpg';
export const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'hybrid', 'plugin_hybrid', 'electric', 'lpg'];
const COMPLIANCE_KINDS: ComplianceKind[] = ['itp', 'rca', 'vignette', 'passenger_insurance', 'arr_copy', 'badge', 'casco'];

export type Car = {
  id: number;
  brand: string;
  model: string;
  year: number;
  description: string | null;
  mileageKm: number | null;
  photoPath: string | null;
  photoUrl: string | null;
  createdAt: string;
  /** Over the plan's vehicle limit: read-only until upgraded or chosen as active. */
  locked: boolean;
  plateNumber: string | null;
  vin: string | null;
  fuelType: FuelType | null;
  euroClass: number | null;
  /** Rented to Bolt/Uber drivers: needs the ride-sharing documents and a 6-month ITP. */
  ridesharing: boolean;
  /** Day the odometer was last entered. */
  mileageUpdatedOn: string;
};

export type Repair = {
  id: number;
  carId: number;
  status: MaintenanceStatus;
  currency: Currency;
  mileageKm: number | null;
  title: string;
  date: string;
  price: number;
  notes: string | null;
  createdAt: string;
};

export type Trip = {
  id: number;
  carId: number;
  status: MaintenanceStatus;
  currency: Currency;
  date: string;
  distance: number;
  fuelUsed: number;
  gasPrice: number | null;
  price: number | null;
  consumption: number;
  createdAt: string;
  /** Explicit driver; null means whoever had the vehicle assigned on that date. */
  driverId: number | null;
};

export type ComplianceRecord = {
  id: number;
  carId: number;
  kind: ComplianceKind;
  issuedDate: string;
  expiresDate: string;
  attachmentPath: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  createdAt: string;
};

export type DailySpend = { date: string; repairSpend: number; tripSpend: number };

type CarRow = {
  id: number; brand: string; model: string; year: number; description: string | null;
  mileage_km: number | null; photo_path: string | null; created_at: string; locked: boolean;
  plate_number: string | null; vin: string | null; fuel_type: string | null; euro_class: number | null; ridesharing: boolean; mileage_updated_on: string;
};
type RepairRow = {
  id: number; car_id: number; status: string; currency: string; mileage_km: number | null;
  title: string; date: string; price: number; notes: string | null; created_at: string;
};
type TripRow = {
  id: number; car_id: number; status: string; currency: string; date: string; distance: number;
  fuel_used: number; gas_price: number | null; price: number | null; consumption: number; created_at: string; driver_id: number | null;
};
type ComplianceRow = {
  id: number; car_id: number; kind: string; issued_date: string; expires_date: string;
  attachment_path: string | null; attachment_name: string | null; attachment_type: string | null; created_at: string;
};
type SpendRow = { date: string; repair_spend: number; trip_spend: number };

const CAR_COLUMNS = 'id, brand, model, year, description, mileage_km, photo_path, created_at, locked, plate_number, vin, fuel_type, euro_class, ridesharing, mileage_updated_on';
const REPAIR_COLUMNS = 'id, car_id, status, currency, mileage_km, title, date, price, notes, created_at';
const TRIP_COLUMNS = 'id, car_id, status, currency, date, distance, fuel_used, gas_price, price, consumption, created_at, driver_id';
const COMPLIANCE_COLUMNS = 'id, car_id, kind, issued_date, expires_date, attachment_path, attachment_name, attachment_type, created_at';

const status = (value: string): MaintenanceStatus => value === 'scheduled' ? 'scheduled' : 'done';
const currency = (value: string): Currency => value === 'EUR' ? 'EUR' : 'RON';
const mapCar = (row: CarRow, photoUrl: string | null = null): Car => ({
  id: row.id, brand: row.brand, model: row.model, year: row.year, description: row.description,
  mileageKm: row.mileage_km, photoPath: row.photo_path, photoUrl, createdAt: row.created_at, locked: row.locked,
  plateNumber: row.plate_number, vin: row.vin, fuelType: FUEL_TYPES.includes(row.fuel_type as FuelType) ? row.fuel_type as FuelType : null,
  euroClass: row.euro_class, ridesharing: row.ridesharing, mileageUpdatedOn: row.mileage_updated_on,
});
const mapRepair = (row: RepairRow): Repair => ({
  id: row.id, carId: row.car_id, status: status(row.status), currency: currency(row.currency),
  mileageKm: row.mileage_km, title: row.title, date: row.date, price: row.price ?? 0,
  notes: row.notes, createdAt: row.created_at,
});
const mapTrip = (row: TripRow): Trip => ({
  id: row.id, carId: row.car_id, status: status(row.status), currency: currency(row.currency), date: row.date,
  distance: row.distance, fuelUsed: row.fuel_used, gasPrice: row.gas_price, price: row.price,
  consumption: row.consumption ?? 0, createdAt: row.created_at, driverId: row.driver_id,
});
const mapCompliance = (row: ComplianceRow, attachmentUrl: string | null = null): ComplianceRecord => ({
  id: row.id, carId: row.car_id, kind: COMPLIANCE_KINDS.includes(row.kind as ComplianceKind) ? row.kind as ComplianceKind : 'itp', issuedDate: row.issued_date,
  expiresDate: row.expires_date, attachmentPath: row.attachment_path, attachmentUrl,
  attachmentName: row.attachment_name, attachmentType: row.attachment_type, createdAt: row.created_at,
});

export async function getCars() {
  const rows = unwrapList(await supabase.from('cars').select(CAR_COLUMNS).order('created_at', { ascending: false }).returns<CarRow[]>(), 'Loading vehicles');
  const urls = await signedUrlMap(CAR_PHOTO_BUCKET, rows.map((row) => row.photo_path));
  return rows.map((row) => mapCar(row, row.photo_path ? urls.get(row.photo_path) ?? null : null));
}

export async function getCar(id: number) {
  const result = await supabase.from('cars').select(CAR_COLUMNS).eq('id', id).maybeSingle<CarRow>();
  if (result.error) throw new Error(`Loading vehicle failed: ${result.error.message}`);
  return result.data ? mapCar(result.data, await signedUrl(CAR_PHOTO_BUCKET, result.data.photo_path)) : null;
}

export type CarInput = {
  brand: string; model: string; year: number; description: string | null; mileageKm: number | null; photoPath: string | null;
  plateNumber: string | null; vin: string | null; fuelType: FuelType | null; euroClass: number | null; ridesharing: boolean;
};
/** Plates are stored upper-case with single spaces ("B 123 ABC"); VINs upper-case without spaces. */
export const normalizePlate = (value: string | null) => value?.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() || null;
const carPayload = (input: CarInput) => ({
  brand: input.brand.trim(), model: input.model.trim(), year: input.year,
  description: input.description?.trim() || null, mileage_km: input.mileageKm, photo_path: input.photoPath,
  plate_number: normalizePlate(input.plateNumber), vin: input.vin?.toUpperCase().replace(/\s+/g, '') || null,
  fuel_type: input.fuelType, euro_class: input.euroClass, ridesharing: input.ridesharing,
});
export async function createCar(input: CarInput) {
  return unwrap(await supabase.from('cars').insert(carPayload(input)).select('id').single<{ id: number }>(), 'Adding vehicle').id;
}

export async function updateCar(id: number, input: CarInput) {
  expectOk(await supabase.from('cars').update(carPayload(input)).eq('id', id), 'Saving vehicle');
}

export async function updateCarMileage(id: number, mileageKm: number | null) {
  expectOk(await supabase.from('cars').update({ mileage_km: mileageKm }).eq('id', id), 'Saving mileage');
}

export async function deleteCar(id: number) {
  const car = await supabase.from('cars').select('photo_path').eq('id', id).maybeSingle<{ photo_path: string | null }>();
  const docs = unwrapList(await supabase.from('compliance_records').select('attachment_path').eq('car_id', id).returns<{ attachment_path: string | null }[]>(), 'Loading documents');
  const fines = unwrapList(await supabase.from('fines').select('attachment_path').eq('car_id', id).returns<{ attachment_path: string | null }[]>(), 'Loading fines');
  docs.push(...fines);
  expectOk(await supabase.from('cars').delete().eq('id', id), 'Deleting vehicle');
  await Promise.allSettled([removeObject(CAR_PHOTO_BUCKET, car.data?.photo_path), ...docs.map((doc) => removeObject(CAR_DOCUMENT_BUCKET, doc.attachment_path))]);
}

export async function getRepairsForCar(carId: number) {
  return unwrapList(await supabase.from('repairs').select(REPAIR_COLUMNS).eq('car_id', carId).order('date', { ascending: false }).returns<RepairRow[]>(), 'Loading repairs').map(mapRepair);
}
export async function getScheduledRepairs() {
  return unwrapList(await supabase.from('repairs').select(REPAIR_COLUMNS).eq('status', 'scheduled').order('date').returns<RepairRow[]>(), 'Loading scheduled repairs').map(mapRepair);
}
export type RepairInput = { carId: number; status: MaintenanceStatus; currency: Currency; mileageKm: number | null; title: string; date: string; price: number; notes: string | null };
export async function createRepair(input: RepairInput) {
  return unwrap(await supabase.from('repairs').insert({ car_id: input.carId, status: input.status, currency: input.currency, notification_ids: [], mileage_km: input.mileageKm, title: input.title.trim(), date: input.date, price: input.price, notes: input.notes?.trim() || null }).select('id').single<{ id: number }>(), 'Adding repair').id;
}
export async function updateRepair(id: number, input: Omit<RepairInput, 'carId'>) {
  expectOk(await supabase.from('repairs').update({ status: input.status, currency: input.currency, mileage_km: input.mileageKm, title: input.title.trim(), date: input.date, price: input.price, notes: input.notes?.trim() || null }).eq('id', id), 'Saving repair');
}
export async function deleteRepair(id: number) { expectOk(await supabase.from('repairs').delete().eq('id', id), 'Deleting repair'); }

export async function getTripsForCar(carId: number) {
  return unwrapList(await supabase.from('trips').select(TRIP_COLUMNS).eq('car_id', carId).order('date', { ascending: false }).returns<TripRow[]>(), 'Loading trips').map(mapTrip);
}
export async function getScheduledTrips() {
  return unwrapList(await supabase.from('trips').select(TRIP_COLUMNS).eq('status', 'scheduled').order('date').returns<TripRow[]>(), 'Loading scheduled trips').map(mapTrip);
}
export type TripInput = { carId: number; status: MaintenanceStatus; currency: Currency; date: string; distance: number; fuelUsed: number; gasPrice: number | null; driverId: number | null };
export async function createTrip(input: TripInput) {
  return unwrap(await supabase.from('trips').insert({ car_id: input.carId, status: input.status, currency: input.currency, notification_ids: [], date: input.date, distance: input.distance, fuel_used: input.fuelUsed, gas_price: input.gasPrice, driver_id: input.driverId }).select('id').single<{ id: number }>(), 'Adding trip').id;
}
export async function updateTrip(id: number, input: Omit<TripInput, 'carId'>) {
  expectOk(await supabase.from('trips').update({ status: input.status, currency: input.currency, date: input.date, distance: input.distance, fuel_used: input.fuelUsed, gas_price: input.gasPrice, driver_id: input.driverId }).eq('id', id), 'Saving trip');
}
export async function deleteTrip(id: number) { expectOk(await supabase.from('trips').delete().eq('id', id), 'Deleting trip'); }

async function withAttachmentUrls(rows: ComplianceRow[]) {
  const urls = await signedUrlMap(CAR_DOCUMENT_BUCKET, rows.map((row) => row.attachment_path));
  return rows.map((row) => mapCompliance(row, row.attachment_path ? urls.get(row.attachment_path) ?? null : null));
}
export async function getComplianceRecordsForCar(carId: number) {
  return withAttachmentUrls(unwrapList(await supabase.from('compliance_records').select(COMPLIANCE_COLUMNS).eq('car_id', carId).order('expires_date').returns<ComplianceRow[]>(), 'Loading documents'));
}
export async function getComplianceRecordsForCars(carIds: number[]) {
  if (!carIds.length) return [];
  return withAttachmentUrls(unwrapList(await supabase.from('compliance_records').select(COMPLIANCE_COLUMNS).in('car_id', carIds).order('expires_date').returns<ComplianceRow[]>(), 'Loading documents'));
}
export type ComplianceInput = { carId: number; kind: ComplianceKind; issuedDate: string; expiresDate: string; attachmentPath: string | null; attachmentName: string | null; attachmentType: string | null };
export async function createComplianceRecord(input: ComplianceInput) {
  return unwrap(await supabase.from('compliance_records').insert({ car_id: input.carId, kind: input.kind, issued_date: input.issuedDate, expires_date: input.expiresDate, attachment_path: input.attachmentPath, attachment_name: input.attachmentName, attachment_type: input.attachmentType, notification_ids: [] }).select('id').single<{ id: number }>(), 'Saving document').id;
}
export async function updateComplianceRecord(id: number, input: Omit<ComplianceInput, 'carId' | 'kind'>) {
  expectOk(await supabase.from('compliance_records').update({ issued_date: input.issuedDate, expires_date: input.expiresDate, attachment_path: input.attachmentPath, attachment_name: input.attachmentName, attachment_type: input.attachmentType }).eq('id', id), 'Saving document');
}
export async function deleteComplianceRecord(id: number) { expectOk(await supabase.from('compliance_records').delete().eq('id', id), 'Deleting document'); }

export async function getDailySpendForMonth(input: { carId?: number; currency: Currency; monthStart: string; nextMonthStart: string }) {
  const result = await supabase.rpc('daily_spend_for_month', { p_currency: input.currency, p_month_start: input.monthStart, p_next_month_start: input.nextMonthStart, p_car_id: input.carId ?? null });
  const rows = unwrapList(result as { data: SpendRow[] | null; error: { message: string } | null }, 'Loading spend');
  return rows.map((row): DailySpend => ({ date: row.date, repairSpend: row.repair_spend ?? 0, tripSpend: row.trip_spend ?? 0 }));
}

export async function getTotalSpendForCar(carId: number, currency: Currency) {
  const days = await getDailySpendForMonth({ carId, currency, monthStart: '1900-01-01', nextMonthStart: '2100-01-01' });
  return days.reduce((sum, day) => sum + day.repairSpend + day.tripSpend, 0);
}

/** Done trips since a date, across all vehicles: the recent driving rate behind service projections. */
export async function getDoneTripsSince(from: string) {
  return unwrapList(await supabase.from('trips').select(TRIP_COLUMNS).eq('status', 'done').gte('date', from).returns<TripRow[]>(), 'Loading trips').map(mapTrip);
}

/** Keeps the newest record of each kind per vehicle, so a renewed document replaces the expired one. */
export function latestDocuments<T extends { kind: string; expiresDate: string }>(records: T[], owner: (record: T) => number) {
  const latest = new Map<string, T>();
  records.forEach((record) => {
    const key = `${owner(record)}:${record.kind}`;
    const current = latest.get(key);
    if (!current || record.expiresDate > current.expiresDate) latest.set(key, record);
  });
  return [...latest.values()];
}

// Service plans
export type ServicePlan = {
  id: number; carId: number; title: string; intervalKm: number | null; intervalMonths: number | null;
  lastDoneOn: string | null; lastDoneKm: number | null; notes: string | null;
};
type ServicePlanRow = { id: number; car_id: number; title: string; interval_km: number | null; interval_months: number | null; last_done_on: string | null; last_done_km: number | null; notes: string | null };
const SERVICE_PLAN_COLUMNS = 'id, car_id, title, interval_km, interval_months, last_done_on, last_done_km, notes';
const mapServicePlan = (row: ServicePlanRow): ServicePlan => ({
  id: row.id, carId: row.car_id, title: row.title, intervalKm: row.interval_km, intervalMonths: row.interval_months,
  lastDoneOn: row.last_done_on, lastDoneKm: row.last_done_km, notes: row.notes,
});
export async function getServicePlans(carId?: number) {
  let query = supabase.from('service_plans').select(SERVICE_PLAN_COLUMNS).order('title');
  if (carId !== undefined) query = query.eq('car_id', carId);
  return unwrapList(await query.returns<ServicePlanRow[]>(), 'Loading service plans').map(mapServicePlan);
}
export type ServicePlanInput = Omit<ServicePlan, 'id'>;
const servicePlanPayload = (input: ServicePlanInput) => ({
  car_id: input.carId, title: input.title.trim(), interval_km: input.intervalKm, interval_months: input.intervalMonths,
  last_done_on: input.lastDoneOn, last_done_km: input.lastDoneKm, notes: input.notes?.trim() || null,
});
export async function createServicePlan(input: ServicePlanInput) {
  return unwrap(await supabase.from('service_plans').insert(servicePlanPayload(input)).select('id').single<{ id: number }>(), 'Saving service plan').id;
}
export async function updateServicePlan(id: number, input: ServicePlanInput) { expectOk(await supabase.from('service_plans').update(servicePlanPayload(input)).eq('id', id), 'Saving service plan'); }
export async function deleteServicePlan(id: number) { expectOk(await supabase.from('service_plans').delete().eq('id', id), 'Deleting service plan'); }
/** Logs the service as a done repair and moves the plan (and the odometer) forward in one transaction. */
export async function completeService(input: { planId: number; date: string; mileageKm: number | null; price: number; currency: Currency; notes: string | null }) {
  const { error } = await supabase.rpc('complete_service', { p_plan_id: input.planId, p_date: input.date, p_mileage_km: input.mileageKm, p_price: input.price, p_currency: input.currency, p_notes: input.notes });
  if (error) throw new Error(`Logging service failed: ${error.message}`);
}

// Fuel consumption against each vehicle's baseline
export type FuelUse = { carId: number; driverId: number | null; distance: number; fuelUsed: number; consumption: number | null; baseline: number | null };
type FuelUseRow = { car_id: number; driver_id: number | null; distance: number; fuel_used: number; consumption: number | null; baseline: number | null };
export async function getFuelUse(from: string, to: string): Promise<FuelUse[]> {
  const rows = unwrapList(await supabase.rpc('fuel_consumption_by_driver', { p_from: from, p_to: to }) as { data: FuelUseRow[] | null; error: { message: string } | null }, 'Loading fuel use');
  return rows.map((row) => ({ carId: row.car_id, driverId: row.driver_id, distance: row.distance, fuelUsed: row.fuel_used, consumption: row.consumption, baseline: row.baseline }));
}

// Fleet profit: rent + commission minus repairs and fleet-paid fines, per vehicle
export type CarProfit = { carId: number | null; income: number; repairCost: number; fineCost: number; profit: number };
type CarProfitRow = { car_id: number | null; income: number; repair_cost: number; fine_cost: number };
export async function getFleetProfit(from: string, to: string, currency: Currency): Promise<CarProfit[]> {
  const rows = unwrapList(await supabase.rpc('fleet_profit_by_car', { p_from: from, p_to: to, p_currency: currency }) as { data: CarProfitRow[] | null; error: { message: string } | null }, 'Loading profit');
  return rows.map((row) => ({ carId: row.car_id, income: row.income, repairCost: row.repair_cost, fineCost: row.fine_cost, profit: row.income - row.repair_cost - row.fine_cost }));
}
