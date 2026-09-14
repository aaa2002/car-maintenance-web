import { CAR_DOCUMENT_BUCKET, CAR_PHOTO_BUCKET, removeObject, signedUrl, signedUrlMap } from './storage';
import { expectOk, supabase, unwrap, unwrapList } from './supabase';

export type MaintenanceStatus = 'done' | 'scheduled';
export type Currency = 'RON' | 'EUR';
export type ComplianceKind = 'itp' | 'rca';

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
  mileage_km: number | null; photo_path: string | null; created_at: string;
};
type RepairRow = {
  id: number; car_id: number; status: string; currency: string; mileage_km: number | null;
  title: string; date: string; price: number; notes: string | null; created_at: string;
};
type TripRow = {
  id: number; car_id: number; status: string; currency: string; date: string; distance: number;
  fuel_used: number; gas_price: number | null; price: number | null; consumption: number; created_at: string;
};
type ComplianceRow = {
  id: number; car_id: number; kind: string; issued_date: string; expires_date: string;
  attachment_path: string | null; attachment_name: string | null; attachment_type: string | null; created_at: string;
};
type SpendRow = { date: string; repair_spend: number; trip_spend: number };

const CAR_COLUMNS = 'id, brand, model, year, description, mileage_km, photo_path, created_at';
const REPAIR_COLUMNS = 'id, car_id, status, currency, mileage_km, title, date, price, notes, created_at';
const TRIP_COLUMNS = 'id, car_id, status, currency, date, distance, fuel_used, gas_price, price, consumption, created_at';
const COMPLIANCE_COLUMNS = 'id, car_id, kind, issued_date, expires_date, attachment_path, attachment_name, attachment_type, created_at';

const status = (value: string): MaintenanceStatus => value === 'scheduled' ? 'scheduled' : 'done';
const currency = (value: string): Currency => value === 'EUR' ? 'EUR' : 'RON';
const mapCar = (row: CarRow, photoUrl: string | null = null): Car => ({
  id: row.id, brand: row.brand, model: row.model, year: row.year, description: row.description,
  mileageKm: row.mileage_km, photoPath: row.photo_path, photoUrl, createdAt: row.created_at,
});
const mapRepair = (row: RepairRow): Repair => ({
  id: row.id, carId: row.car_id, status: status(row.status), currency: currency(row.currency),
  mileageKm: row.mileage_km, title: row.title, date: row.date, price: row.price ?? 0,
  notes: row.notes, createdAt: row.created_at,
});
const mapTrip = (row: TripRow): Trip => ({
  id: row.id, carId: row.car_id, status: status(row.status), currency: currency(row.currency), date: row.date,
  distance: row.distance, fuelUsed: row.fuel_used, gasPrice: row.gas_price, price: row.price,
  consumption: row.consumption ?? 0, createdAt: row.created_at,
});
const mapCompliance = (row: ComplianceRow, attachmentUrl: string | null = null): ComplianceRecord => ({
  id: row.id, carId: row.car_id, kind: row.kind === 'rca' ? 'rca' : 'itp', issuedDate: row.issued_date,
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

export type CarInput = { brand: string; model: string; year: number; description: string | null; mileageKm: number | null; photoPath: string | null };
export async function createCar(input: CarInput) {
  return unwrap(await supabase.from('cars').insert({
    brand: input.brand.trim(), model: input.model.trim(), year: input.year,
    description: input.description?.trim() || null, mileage_km: input.mileageKm, photo_path: input.photoPath,
  }).select('id').single<{ id: number }>(), 'Adding vehicle').id;
}

export async function updateCar(id: number, input: CarInput) {
  expectOk(await supabase.from('cars').update({
    brand: input.brand.trim(), model: input.model.trim(), year: input.year,
    description: input.description?.trim() || null, mileage_km: input.mileageKm, photo_path: input.photoPath,
  }).eq('id', id), 'Saving vehicle');
}

export async function updateCarMileage(id: number, mileageKm: number | null) {
  expectOk(await supabase.from('cars').update({ mileage_km: mileageKm }).eq('id', id), 'Saving mileage');
}

export async function deleteCar(id: number) {
  const car = await supabase.from('cars').select('photo_path').eq('id', id).maybeSingle<{ photo_path: string | null }>();
  const docs = unwrapList(await supabase.from('compliance_records').select('attachment_path').eq('car_id', id).returns<{ attachment_path: string | null }[]>(), 'Loading documents');
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
export type TripInput = { carId: number; status: MaintenanceStatus; currency: Currency; date: string; distance: number; fuelUsed: number; gasPrice: number | null };
export async function createTrip(input: TripInput) {
  return unwrap(await supabase.from('trips').insert({ car_id: input.carId, status: input.status, currency: input.currency, notification_ids: [], date: input.date, distance: input.distance, fuel_used: input.fuelUsed, gas_price: input.gasPrice }).select('id').single<{ id: number }>(), 'Adding trip').id;
}
export async function updateTrip(id: number, input: Omit<TripInput, 'carId'>) {
  expectOk(await supabase.from('trips').update({ status: input.status, currency: input.currency, date: input.date, distance: input.distance, fuel_used: input.fuelUsed, gas_price: input.gasPrice }).eq('id', id), 'Saving trip');
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
