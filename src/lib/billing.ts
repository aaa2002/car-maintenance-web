import { FunctionsHttpError } from '@supabase/supabase-js';
import { AppError } from './format';
import { supabase, unwrapList } from './supabase';

export type PlanId = 'free' | 'standard' | 'pro' | 'fleet';
export type Plan = { id: PlanId; name: string; vehicleLimit: number | null; includedVehicles: number; monthlyPrice: number; extraVehiclePrice: number };
export type BillingOverview = {
  planId: PlanId;
  vehicleLimit: number | null;
  includedVehicles: number;
  vehiclesUsed: number;
  lockedVehicles: number;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A downgrade that takes effect at the end of the paid period. */
  scheduledPlanId: PlanId | null;
};

type PlanRow = { id: PlanId; name: string; vehicle_limit: number | null; included_vehicles: number; monthly_price_bani: number; extra_vehicle_price_bani: number };
type OverviewRow = { plan_id: PlanId; vehicle_limit: number | null; included_vehicles: number; vehicles_used: number; locked_vehicles: number; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; scheduled_plan_id: PlanId | null };

export async function getPlans(): Promise<Plan[]> {
  const rows = unwrapList(await supabase.from('plans').select('id, name, vehicle_limit, included_vehicles, monthly_price_bani, extra_vehicle_price_bani').order('sort_order') as { data: PlanRow[] | null; error: { message: string } | null }, 'Loading plans');
  return rows.map((row) => ({ id: row.id, name: row.name, vehicleLimit: row.vehicle_limit, includedVehicles: row.included_vehicles, monthlyPrice: row.monthly_price_bani / 100, extraVehiclePrice: row.extra_vehicle_price_bani / 100 }));
}

export async function getBillingOverview(): Promise<BillingOverview> {
  const [row] = unwrapList(await supabase.rpc('billing_overview') as { data: OverviewRow[] | null; error: { message: string } | null }, 'Loading plan');
  if (!row) return { planId: 'free', vehicleLimit: 3, includedVehicles: 3, vehiclesUsed: 0, lockedVehicles: 0, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, scheduledPlanId: null };
  return { planId: row.plan_id, vehicleLimit: row.vehicle_limit, includedVehicles: row.included_vehicles, vehiclesUsed: row.vehicles_used, lockedVehicles: row.locked_vehicles, status: row.status, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end, scheduledPlanId: row.scheduled_plan_id };
}

// Paid plan names are brand names and stay the same in every language.
const PAID_PLAN_NAMES: Record<Exclude<PlanId, 'free'>, string> = { standard: 'Standard', pro: 'PRO', fleet: 'FLEET' };
export const planLabel = (id: PlanId, t: (key: 'planFree') => string) => (id === 'free' ? t('planFree') : PAID_PLAN_NAMES[id]);

/** True when the user cannot add another vehicle on their current plan. */
export const atVehicleLimit = (overview: BillingOverview) => overview.vehicleLimit !== null && overview.vehiclesUsed >= overview.vehicleLimit;

// Error codes returned by the billing Edge Functions, mapped to translated messages.
const FUNCTION_ERRORS = {
  billing_not_configured: 'billingUnavailable',
  already_subscribed: 'billingAlreadySubscribed',
  no_subscription: 'billingNoSubscription',
  no_customer: 'billingNoSubscription',
  origin_not_allowed: 'billingUnavailable',
  unknown_plan: 'billingUnavailable',
} as const;

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const code = error instanceof FunctionsHttpError ? (await error.context.json().catch(() => null))?.error : null;
    const key = code && FUNCTION_ERRORS[code as keyof typeof FUNCTION_ERRORS];
    throw key ? new AppError(key) : new Error(code ?? error.message);
  }
  return data as T;
}

/** Sends the browser to Stripe Checkout for a paid plan (users without a subscription). */
export async function startCheckout(plan: PlanId, locale: 'en' | 'ro') {
  const { url } = await invoke<{ url: string }>('billing-checkout', { plan, locale });
  location.assign(url);
}

/** Switches plan, or schedules / undoes cancellation, for an existing subscription. */
export function changePlan(input: { action: 'change'; plan: PlanId } | { action: 'cancel' | 'resume' }) {
  return invoke<{ ok: boolean; applied?: boolean; pending?: boolean; scheduled?: boolean }>('billing-change-plan', input);
}

/** Chooses which vehicles stay editable (up to the plan's limit); the rest become read-only. */
export async function setActiveVehicles(carIds: number[]) {
  const { error } = await supabase.rpc('set_active_vehicles', { p_car_ids: carIds });
  if (error) throw new Error(error.message);
}

/** Opens the Stripe customer portal (card, invoices, cancellation). */
export async function openBillingPortal(locale: 'en' | 'ro') {
  const { url } = await invoke<{ url: string }>('billing-portal', { locale });
  location.assign(url);
}
