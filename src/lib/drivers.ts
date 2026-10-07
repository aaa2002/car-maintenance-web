import type { Currency } from './database';
import { expectOk, supabase, unwrap, unwrapList } from './supabase';

export type Driver = { id: number; fullName: string; phone: string | null; email: string | null; licenseNumber: string | null; notes: string | null; active: boolean };
export type Assignment = { id: number; driverId: number; carId: number | null; vehicleLabel: string; startsOn: string; endsOn: string | null; notes: string | null };
export type SettlementStatus = 'paid' | 'partial' | 'unpaid';
export type Settlement = {
  id: number; driverId: number; carId: number | null; vehicleLabel: string | null; weekStart: string; dueDate: string; currency: Currency;
  boltEarnings: number; uberEarnings: number; fleetCommission: number; vehicleRent: number; expenses: number; fines: number; bonuses: number;
  manualAdjustment: number; amountSettled: number; notes: string | null;
  /** Computed in the database: earnings + bonuses + adjustment - commission - rent - expenses - fines. Positive = owed to the driver. */
  netAmount: number; outstandingAmount: number; status: SettlementStatus;
};
export type DriverReportRow = {
  driverId: number; fullName: string; active: boolean; vehicles: string | null;
  trips: number; distance: number; fuelUsed: number; fuelCost: number; repairs: number; repairCost: number;
  weeks: number; grossEarnings: number; vehicleRent: number; fleetCommission: number; fines: number;
  payout: number; settled: number; outstanding: number; outstandingAllTime: number;
};

type DriverRow = { id: number; full_name: string; phone: string | null; email: string | null; license_number: string | null; notes: string | null; active: boolean };
type AssignmentRow = { id: number; driver_id: number; car_id: number | null; vehicle_label: string; starts_on: string; ends_on: string | null; notes: string | null };
type SettlementRow = {
  id: number; driver_id: number; car_id: number | null; vehicle_label: string | null; week_start: string; due_date: string; currency: string;
  bolt_earnings: number; uber_earnings: number; fleet_commission: number; vehicle_rent: number; expenses: number; fines: number; bonuses: number;
  manual_adjustment: number; amount_settled: number; notes: string | null; net_amount: number; outstanding_amount: number; status: string;
};

const DRIVER_COLUMNS = 'id, full_name, phone, email, license_number, notes, active';
const ASSIGNMENT_COLUMNS = 'id, driver_id, car_id, vehicle_label, starts_on, ends_on, notes';
const SETTLEMENT_COLUMNS = 'id, driver_id, car_id, vehicle_label, week_start, due_date, currency, bolt_earnings, uber_earnings, fleet_commission, vehicle_rent, expenses, fines, bonuses, manual_adjustment, amount_settled, notes, net_amount, outstanding_amount, status';

const mapDriver = (row: DriverRow): Driver => ({ id: row.id, fullName: row.full_name, phone: row.phone, email: row.email, licenseNumber: row.license_number, notes: row.notes, active: row.active });
const mapAssignment = (row: AssignmentRow): Assignment => ({ id: row.id, driverId: row.driver_id, carId: row.car_id, vehicleLabel: row.vehicle_label, startsOn: row.starts_on, endsOn: row.ends_on, notes: row.notes });
const mapSettlement = (row: SettlementRow): Settlement => ({
  id: row.id, driverId: row.driver_id, carId: row.car_id, vehicleLabel: row.vehicle_label, weekStart: row.week_start, dueDate: row.due_date,
  currency: row.currency === 'EUR' ? 'EUR' : 'RON', boltEarnings: row.bolt_earnings, uberEarnings: row.uber_earnings, fleetCommission: row.fleet_commission,
  vehicleRent: row.vehicle_rent, expenses: row.expenses, fines: row.fines, bonuses: row.bonuses, manualAdjustment: row.manual_adjustment,
  amountSettled: row.amount_settled, notes: row.notes, netAmount: row.net_amount, outstandingAmount: row.outstanding_amount,
  status: row.status === 'paid' ? 'paid' : row.status === 'partial' ? 'partial' : 'unpaid',
});

// Drivers
export async function getDrivers() {
  return unwrapList(await supabase.from('drivers').select(DRIVER_COLUMNS).order('active', { ascending: false }).order('full_name').returns<DriverRow[]>(), 'Loading drivers').map(mapDriver);
}
export async function getDriver(id: number) {
  const result = await supabase.from('drivers').select(DRIVER_COLUMNS).eq('id', id).maybeSingle<DriverRow>();
  if (result.error) throw new Error(`Loading driver failed: ${result.error.message}`);
  return result.data ? mapDriver(result.data) : null;
}
export type DriverInput = { fullName: string; phone: string | null; email: string | null; licenseNumber: string | null; notes: string | null; active: boolean };
const driverPayload = (input: DriverInput) => ({ full_name: input.fullName.trim(), phone: input.phone?.trim() || null, email: input.email?.trim() || null, license_number: input.licenseNumber?.trim() || null, notes: input.notes?.trim() || null, active: input.active });
export async function createDriver(input: DriverInput) {
  return unwrap(await supabase.from('drivers').insert(driverPayload(input)).select('id').single<{ id: number }>(), 'Adding driver').id;
}
export async function updateDriver(id: number, input: DriverInput) { expectOk(await supabase.from('drivers').update(driverPayload(input)).eq('id', id), 'Saving driver'); }
export async function deleteDriver(id: number) { expectOk(await supabase.from('drivers').delete().eq('id', id), 'Deleting driver'); }

// Assignments
export async function getAssignmentsForDriver(driverId: number) {
  return unwrapList(await supabase.from('driver_assignments').select(ASSIGNMENT_COLUMNS).eq('driver_id', driverId).order('starts_on', { ascending: false }).returns<AssignmentRow[]>(), 'Loading assignments').map(mapAssignment);
}
/** Open assignments (no end date), keyed by vehicle: who currently drives each car. */
export async function getCurrentAssignments() {
  return unwrapList(await supabase.from('driver_assignments').select(ASSIGNMENT_COLUMNS).is('ends_on', null).returns<AssignmentRow[]>(), 'Loading assignments').map(mapAssignment);
}
/** Assigns a vehicle from a date; the database closes the driver's and the vehicle's previous open assignments. */
export async function assignDriver(driverId: number, carId: number, startsOn: string, notes: string | null) {
  const { error } = await supabase.rpc('assign_driver', { p_driver_id: driverId, p_car_id: carId, p_starts_on: startsOn, p_notes: notes });
  if (error) throw new Error(`Assigning vehicle failed: ${error.message}`);
}
export async function endAssignment(id: number, endsOn: string) { expectOk(await supabase.from('driver_assignments').update({ ends_on: endsOn }).eq('id', id), 'Ending assignment'); }
export async function deleteAssignment(id: number) { expectOk(await supabase.from('driver_assignments').delete().eq('id', id), 'Deleting assignment'); }

// Weekly settlements
export async function getSettlementsForDriver(driverId: number) {
  return unwrapList(await supabase.from('weekly_settlements').select(SETTLEMENT_COLUMNS).eq('driver_id', driverId).order('week_start', { ascending: false }).returns<SettlementRow[]>(), 'Loading settlements').map(mapSettlement);
}
export type SettlementInput = Omit<Settlement, 'id' | 'netAmount' | 'outstandingAmount' | 'status'>;
const settlementPayload = (input: SettlementInput) => ({
  driver_id: input.driverId, car_id: input.carId, vehicle_label: input.vehicleLabel, week_start: input.weekStart, due_date: input.dueDate, currency: input.currency,
  bolt_earnings: input.boltEarnings, uber_earnings: input.uberEarnings, fleet_commission: input.fleetCommission, vehicle_rent: input.vehicleRent,
  expenses: input.expenses, fines: input.fines, bonuses: input.bonuses, manual_adjustment: input.manualAdjustment, amount_settled: input.amountSettled, notes: input.notes?.trim() || null,
});
export async function createSettlement(input: SettlementInput) {
  return unwrap(await supabase.from('weekly_settlements').insert(settlementPayload(input)).select('id').single<{ id: number }>(), 'Saving settlement').id;
}
export async function updateSettlement(id: number, input: SettlementInput) { expectOk(await supabase.from('weekly_settlements').update(settlementPayload(input)).eq('id', id), 'Saving settlement'); }
/** Settles the whole week: payouts are paid to the driver, debts are paid back by them. */
export async function markSettlementPaid(settlement: Pick<Settlement, 'id' | 'netAmount'>) {
  expectOk(await supabase.from('weekly_settlements').update({ amount_settled: Math.round(Math.abs(settlement.netAmount) * 100) / 100 }).eq('id', settlement.id), 'Saving settlement');
}
export async function deleteSettlement(id: number) { expectOk(await supabase.from('weekly_settlements').delete().eq('id', id), 'Deleting settlement'); }

/** Same formula as the database's generated column, for live previews while editing. */
export const settlementNet = (s: Pick<SettlementInput, 'boltEarnings' | 'uberEarnings' | 'bonuses' | 'manualAdjustment' | 'fleetCommission' | 'vehicleRent' | 'expenses' | 'fines'>) =>
  s.boltEarnings + s.uberEarnings + s.bonuses + s.manualAdjustment - s.fleetCommission - s.vehicleRent - s.expenses - s.fines;

// Reporting
type ReportRow = {
  driver_id: number; full_name: string; active: boolean; vehicles: string | null; trips: number; distance: number; fuel_used: number; fuel_cost: number;
  repairs: number; repair_cost: number; weeks: number; gross_earnings: number; vehicle_rent: number; fleet_commission: number; fines: number;
  payout: number; settled: number; outstanding: number; outstanding_all_time: number;
};
export async function getDriverReport(from: string, to: string, currency: Currency): Promise<DriverReportRow[]> {
  const rows = unwrapList(await supabase.rpc('driver_report', { p_from: from, p_to: to, p_currency: currency }) as { data: ReportRow[] | null; error: { message: string } | null }, 'Loading driver report');
  return rows.map((row) => ({
    driverId: row.driver_id, fullName: row.full_name, active: row.active, vehicles: row.vehicles, trips: row.trips, distance: row.distance, fuelUsed: row.fuel_used,
    fuelCost: row.fuel_cost, repairs: row.repairs, repairCost: row.repair_cost, weeks: row.weeks, grossEarnings: row.gross_earnings, vehicleRent: row.vehicle_rent,
    fleetCommission: row.fleet_commission, fines: row.fines, payout: row.payout, settled: row.settled, outstanding: row.outstanding, outstandingAllTime: row.outstanding_all_time,
  }));
}

/** What the fleet earns from a driver in the period: rent + commission, minus repairs on their vehicles. Fuel is paid by the driver. */
export const contribution = (row: DriverReportRow) => row.vehicleRent + row.fleetCommission - row.repairCost;
/** Fuel consumption in L/100 km, or null without distance. */
export const consumptionOf = (fuel: number, distance: number) => (distance > 0 ? (fuel / distance) * 100 : null);

/** Who had a vehicle assigned on a date (null if nobody). */
export async function driverForCarOn(carId: number, date: string) {
  const { data, error } = await supabase.rpc('driver_for_car_on', { p_car_id: carId, p_date: date });
  if (error) throw new Error(`Loading assigned driver failed: ${error.message}`);
  return (data as number | null) ?? null;
}
