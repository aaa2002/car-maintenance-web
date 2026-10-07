'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { changePlan, getBillingOverview, getPlans, openBillingPortal, planLabel, setActiveVehicles, startCheckout, type BillingOverview, type Plan, type PlanId } from '@/lib/billing';
import { getCars, type Car } from '@/lib/database';
import { localDate } from '@/lib/format';
import { useSettings } from './providers';
import { ErrorAlert, Modal, SectionHeader, StatusPill, useToast } from './ui';

const price = (value: number, language: 'en' | 'ro') =>
  new Intl.NumberFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { style: 'currency', currency: 'RON', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

type Pending = { kind: 'switch'; plan: Plan } | { kind: 'cancel' } | null;

export function PlanSection() {
  const { t, language } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<Pending>(null);
  const [choosing, setChoosing] = useState<{ cars: Car[]; selected: Set<number> } | null>(null);

  const load = useCallback(async () => {
    const [nextPlans, nextOverview] = await Promise.all([getPlans(), getBillingOverview()]);
    setPlans(nextPlans); setOverview(nextOverview);
    return nextOverview;
  }, []);

  useEffect(() => { load().catch(setError); }, [load]);

  // Back from Stripe Checkout: the webhook activates the plan a moment later, so poll briefly.
  useEffect(() => {
    const result = params.get('billing');
    if (!result) return;
    router.replace('/settings', { scroll: false });
    if (result === 'cancelled') { toast(t('checkoutCancelled')); return; }
    toast(t('checkoutSuccess'));
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const next = await load().catch(() => null);
      if ((next && next.planId !== 'free') || tries >= 8) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [params, router, toast, t, load]);

  const subscribed = Boolean(overview?.status);
  const planName = (id: PlanId) => planLabel(id, t);
  const planById = (id: PlanId) => plans.find((plan) => plan.id === id);
  const periodEnd = overview?.currentPeriodEnd ? localDate(overview.currentPeriodEnd.slice(0, 10), language) : '';
  const changeScheduled = Boolean(overview?.scheduledPlanId || overview?.cancelAtPeriodEnd);
  // Vehicles that would become read-only on a plan with this limit.
  const extraFor = (limit: number | null) => (overview && limit !== null ? Math.max(0, overview.vehiclesUsed - limit) : 0);

  async function run(key: string, action: () => Promise<unknown>, message?: string) {
    setBusy(key); setError(undefined);
    try { await action(); if (message) toast(message); await load(); }
    catch (caught) { setError(caught); }
    finally { setBusy(null); setPending(null); }
  }

  function choose(plan: Plan) {
    if (!overview || plan.id === overview.planId) return;
    if (plan.id === 'free') { setPending({ kind: 'cancel' }); return; }
    if (!subscribed) { run(plan.id, () => startCheckout(plan.id, language)); return; }
    setPending({ kind: 'switch', plan });
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === 'cancel') return run('free', () => changePlan({ action: 'cancel' }), t('subscriptionCancelled'));
    const plan = pending.plan;
    setBusy(plan.id); setError(undefined);
    try {
      const result = await changePlan({ action: 'change', plan: plan.id });
      toast(result.scheduled ? t('planScheduled') : result.pending ? t('planPending') : t('planChanged'));
      await load();
    } catch (caught) { setError(caught); }
    finally { setBusy(null); setPending(null); }
  }

  async function openChooser() {
    setError(undefined);
    try {
      const cars = await getCars();
      setChoosing({ cars, selected: new Set(cars.filter((car) => !car.locked).map((car) => car.id)) });
    } catch (caught) { setError(caught); }
  }

  function toggle(id: number) {
    if (!choosing || !overview) return;
    const selected = new Set(choosing.selected);
    if (selected.has(id)) selected.delete(id);
    else if (overview.vehicleLimit === null || selected.size < overview.vehicleLimit) selected.add(id);
    setChoosing({ ...choosing, selected });
  }

  async function saveChoice() {
    if (!choosing) return;
    await run('choose', () => setActiveVehicles([...choosing.selected]), t('activeVehiclesSaved'));
    setChoosing(null);
  }

  function confirmText() {
    if (!pending || !overview) return '';
    const current = planName(overview.planId);
    if (pending.kind === 'cancel') {
      const extra = extraFor(planById('free')?.vehicleLimit ?? 3);
      return [t('confirmCancelAt').replace('{date}', periodEnd).replace('{current}', current), extra ? t('willLock').replace('{n}', String(extra)) : ''].filter(Boolean).join(' ');
    }
    const next = pending.plan;
    const upgrade = next.monthlyPrice > (planById(overview.planId)?.monthlyPrice ?? 0);
    if (upgrade) return t('confirmUpgrade').replace('{plan}', planName(next.id));
    const extra = extraFor(next.vehicleLimit);
    return [t('confirmDowngrade').replace('{plan}', planName(next.id)).replace('{date}', periodEnd).replace('{current}', current), extra ? t('willLock').replace('{n}', String(extra)) : ''].filter(Boolean).join(' ');
  }

  const status = !overview ? null
    : overview.status === 'past_due' ? <StatusPill tone="danger">{t('paymentIssue')}</StatusPill>
    : overview.scheduledPlanId ? <StatusPill tone="warning">{t('switchesOn').replace('{plan}', planName(overview.scheduledPlanId)).replace('{date}', periodEnd)}</StatusPill>
    : overview.cancelAtPeriodEnd ? <StatusPill tone="warning">{t('endsOn').replace('{date}', periodEnd)}</StatusPill>
    : periodEnd ? <StatusPill tone="success">{t('renewsOn').replace('{date}', periodEnd)}</StatusPill>
    : null;

  const usage = overview
    ? overview.vehicleLimit === null
      ? t('vehiclesUsedUnlimited').replace('{used}', String(overview.vehiclesUsed))
      : t('vehiclesUsed').replace('{used}', String(overview.vehiclesUsed)).replace('{limit}', String(overview.vehicleLimit))
    : '';
  const ratio = overview ? Math.min(1, overview.vehiclesUsed / (overview.vehicleLimit ?? overview.includedVehicles)) : 0;

  return (
    <section className="section-gap" id="plan">
      <SectionHeader title={t('plan')} action={subscribed && <button className="btn btn-sm btn-outline-secondary" disabled={busy !== null} onClick={() => run('portal', () => openBillingPortal(language))}>{busy === 'portal' && <span className="spinner-border spinner-border-sm me-2" />}{t('manageBilling')}</button>} />
      {Boolean(error) && <ErrorAlert error={error} />}

      {!overview ? <div className="app-panel plan-summary" aria-hidden="true"><div className="skeleton" style={{ width: 160, height: 22 }} /><div className="skeleton" style={{ width: 220, height: 10 }} /></div> : (
        <div className="app-panel plan-summary">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <strong className="plan-summary-name">{planName(overview.planId)}</strong>
            {status}
            {changeScheduled && <button className="btn btn-sm btn-link px-1" disabled={busy !== null} onClick={() => run('resume', () => changePlan({ action: 'resume' }), t('subscriptionResumed'))}>{t('keepPlan').replace('{plan}', planName(overview.planId))}</button>}
          </div>
          <div className="plan-usage">
            <span className="small text-body-secondary num">{usage}</span>
            <span className={`plan-meter ${ratio >= 1 && overview.vehicleLimit !== null ? 'full' : ''}`} aria-hidden="true"><span style={{ transform: `scaleX(${ratio})` }} /></span>
          </div>
          {overview.lockedVehicles > 0 && (
            <div className="plan-locked">
              <span><i className="bi bi-lock me-2" aria-hidden="true" />{t('lockedNotice').replace('{n}', String(overview.lockedVehicles))}</span>
              <button className="btn btn-sm btn-outline-secondary" disabled={busy !== null} onClick={openChooser}>{t('chooseActive')}</button>
            </div>
          )}
        </div>
      )}

      <div className="plan-grid">
        {plans.map((plan) => {
          const current = overview?.planId === plan.id;
          const label = current ? t('currentPlan') : plan.id === 'free' ? t('cancelSubscription') : subscribed ? t('switchPlan') : t('choosePlan');
          const hideFreeAction = plan.id === 'free' && (!subscribed || overview?.cancelAtPeriodEnd);
          return (
            <div className={`plan-tile ${current ? 'current' : ''}`} key={plan.id}>
              <div>
                <span className="plan-tile-name">{planName(plan.id)}</span>
                <div className="plan-tile-price"><strong className="num">{price(plan.monthlyPrice, language)}</strong>{plan.monthlyPrice > 0 && <span>{t('perMonth')}</span>}</div>
                <p className="plan-tile-detail">{plan.vehicleLimit === null
                  ? t('fleetVehicles').replace('{n}', String(plan.includedVehicles)).replace('{price}', price(plan.extraVehiclePrice, language))
                  : t('upToVehicles').replace('{n}', String(plan.vehicleLimit))}</p>
              </div>
              {!hideFreeAction && (
                <button
                  className={`btn btn-sm w-100 ${current ? 'btn-outline-secondary' : plan.id === 'free' ? 'btn-outline-danger' : 'btn-primary'}`}
                  disabled={current || busy !== null || !overview}
                  onClick={() => choose(plan)}
                >
                  {busy === plan.id && <span className="spinner-border spinner-border-sm me-2" />}{label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="small text-body-secondary mt-3 mb-0">{t('vatIncluded')}</p>

      <Modal title={pending?.kind === 'cancel' ? t('cancelSubscription') : t('switchPlan')} show={pending !== null} onClose={() => busy === null && setPending(null)} variant="modal">
        <div className="modal-body"><p className="mb-0 text-body-secondary">{confirmText()}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline-secondary" disabled={busy !== null} onClick={() => setPending(null)}>{t('cancel')}</button>
          <button type="button" className={`btn ${pending?.kind === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={busy !== null} onClick={confirmPending}>
            {busy !== null && <span className="spinner-border spinner-border-sm me-2" />}{pending?.kind === 'cancel' ? t('cancelSubscription') : t('switchPlan')}
          </button>
        </div>
      </Modal>

      <Modal title={t('chooseActive')} show={choosing !== null} onClose={() => busy === null && setChoosing(null)} variant="modal">
        <div className="modal-body">
          <p className="text-body-secondary">{t('chooseActiveHint').replace('{limit}', String(overview?.vehicleLimit ?? ''))}</p>
          <div className="active-chooser">
            {choosing?.cars.map((car) => {
              const checked = choosing.selected.has(car.id);
              const full = overview?.vehicleLimit !== null && overview !== null && choosing.selected.size >= (overview.vehicleLimit ?? 0);
              return (
                <label className={`active-option ${checked ? 'checked' : ''}`} key={car.id}>
                  <input type="checkbox" className="form-check-input mt-0" checked={checked} disabled={!checked && full} onChange={() => toggle(car.id)} />
                  <span className="min-w-0 flex-grow-1"><span className="d-block fw-semibold truncate">{car.brand} {car.model}</span><span className="d-block small text-body-secondary">{car.year}</span></span>
                  {!checked && <StatusPill tone="neutral">{t('readOnly')}</StatusPill>}
                </label>
              );
            })}
          </div>
          <p className="small text-body-secondary mt-3 mb-0 num">{t('selectedOf').replace('{n}', String(choosing?.selected.size ?? 0)).replace('{limit}', String(overview?.vehicleLimit ?? ''))}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline-secondary" disabled={busy !== null} onClick={() => setChoosing(null)}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={busy !== null || !choosing?.selected.size} onClick={saveChoice}>{busy === 'choose' && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button>
        </div>
      </Modal>
    </section>
  );
}
