'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AssignVehicleForm, DriverForm, EndAssignmentForm, SettlementForm } from '@/components/driver-forms';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, stagger, StatusPill, useToast } from '@/components/ui';
import { getCars, type Car } from '@/lib/database';
import { consumptionOf, contribution, deleteAssignment, deleteDriver, deleteSettlement, getAssignmentsForDriver, markSettlementPaid, getDriver, getDriverReport, getSettlementsForDriver, type Assignment, type Driver, type DriverReportRow, type Settlement } from '@/lib/drivers';
import { localDate, money, monthRange, number } from '@/lib/format';

export default function DriverPage() {
  const { id } = useParams<{ id: string }>();
  const driverId = Number(id);
  const router = useRouter();
  const { t, language, currency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [report, setReport] = useState<DriverReportRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<Assignment | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const period = monthRange(offset, language);

  const load = useCallback(async () => {
    if (!user || !Number.isInteger(driverId)) return;
    setError(undefined);
    try {
      const [nextDriver, nextCars, nextAssignments, nextSettlements] = await Promise.all([getDriver(driverId), getCars(), getAssignmentsForDriver(driverId), getSettlementsForDriver(driverId)]);
      setDriver(nextDriver); setCars(nextCars); setAssignments(nextAssignments); setSettlements(nextSettlements);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, driverId]);
  useEffect(() => { void load(); }, [load]);

  const loadReport = useCallback(async () => {
    if (!user) return;
    try { setReport(await getDriverReport(period.from, period.to, currency)); } catch (caught) { setError(caught); }
  }, [user, period.from, period.to, currency]);
  useEffect(() => { void loadReport(); }, [loadReport, settlements, assignments]);

  const current = assignments.find((assignment) => assignment.endsOn === null) ?? null;
  const row = report.find((value) => value.driverId === driverId);
  const fleet = useMemo(() => report.reduce((sum, value) => ({ fuel: sum.fuel + value.fuelUsed, distance: sum.distance + value.distance }), { fuel: 0, distance: 0 }), [report]);
  const own = row ? consumptionOf(row.fuelUsed, row.distance) : null;
  const fleetAverage = consumptionOf(fleet.fuel, fleet.distance);
  const reload = async () => { await load(); };
  const [markingId, setMarkingId] = useState<number | null>(null);
  async function markPaid(settlement: Settlement) {
    setMarkingId(settlement.id);
    try { await markSettlementPaid(settlement); await reload(); toast(t('markedPaid')); }
    catch (caught) { setError(caught); }
    finally { setMarkingId(null); }
  }

  const balanceLabel = (value: number) => (value > 0.005 ? t('payoutToDriver') : value < -0.005 ? t('driverOwes') : t('outstanding'));
  const statusTone = { paid: 'success', partial: 'warning', unpaid: 'danger' } as const;
  const statusLabel = { paid: t('settlementPaid'), partial: t('settlementPartial'), unpaid: t('settlementUnpaid') } as const;

  if (!Number.isInteger(driverId)) return <AppShell><ErrorAlert error={new Error('Invalid driver ID.')} /></AppShell>;

  return <AppShell>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}
    {loading ? <ListSkeleton rows={4} /> : !driver ? <div className="app-panel"><Empty icon="bi-person" title={t('noDrivers')} action={<Link href="/drivers" className="btn btn-primary">{t('drivers')}</Link>} /></div> : <>
      <PageHeader
        back={<Link href="/drivers" className="back-link"><i className="bi bi-arrow-left" />{t('drivers')}</Link>}
        title={driver.fullName}
        subtitle={[driver.phone, driver.email, driver.licenseNumber].filter(Boolean).join(' · ') || undefined}
        action={<button className="btn btn-outline-secondary" onClick={() => setEditing(true)}><i className="bi bi-pencil me-sm-2" /><span className="d-none d-sm-inline">{t('edit')}</span></button>}
      />
      {!driver.active && <div className="mb-3"><StatusPill tone="neutral">{t('inactive')}</StatusPill></div>}

      <div className="app-panel driver-current section-gap">
        <span className="row-icon tone-brand"><i className="bi bi-car-front" /></span>
        <span className="data-row-main">
          <span className="metric-label d-block">{t('currentVehicle')}</span>
          <strong className="d-block">{current ? current.vehicleLabel : t('noVehicleAssigned')}</strong>
          {current && <span className="small text-body-secondary">{t('startsOn')} {localDate(current.startsOn, language)}</span>}
        </span>
        <span className="d-flex flex-wrap gap-2">
          {current && <button className="btn btn-sm btn-outline-secondary" onClick={() => setEnding(current)}>{t('endAssignment')}</button>}
          <button className="btn btn-sm btn-primary" onClick={() => setAssigning(true)}>{current ? t('changeVehicle') : t('assignVehicle')}</button>
        </span>
      </div>

      <SectionHeader title={`${t('periodReport')} · ${period.label}`} action={<div className="segmented">
        <button aria-label={t('previous')} onClick={() => setOffset((value) => value - 1)}><i className="bi bi-chevron-left" /></button>
        <button className={!offset ? 'active' : ''} onClick={() => setOffset(0)}>{t('thisMonth')}</button>
        <button aria-label={t('next')} disabled={offset >= 0} onClick={() => setOffset((value) => value + 1)}><i className="bi bi-chevron-right" /></button>
      </div>} />
      <div className="app-panel stat-strip">
        <div className="stat-item"><span className="metric-label">{t('loggedDistance')}</span><strong className="metric-value">{number(row?.distance ?? 0, language, 0)} km</strong></div>
        <div className="stat-item"><span className="metric-label">{t('avgConsumption')}</span><strong className="metric-value">{own === null ? '-' : `${number(own, language)} L/100`}</strong>{fleetAverage !== null && <span className="small text-body-secondary num">{t('fleetAverage').replace('{value}', `${number(fleetAverage, language)} L/100`)}</span>}</div>
        <div className="stat-item"><span className="metric-label">{t('earnings')}</span><strong className="metric-value">{money(row?.grossEarnings ?? 0, currency, language)}</strong></div>
        <div className="stat-item"><span className="metric-label">{t('contribution')}</span><strong className="metric-value">{money(row ? contribution(row) : 0, currency, language)}</strong></div>
        <div className="stat-item"><span className="metric-label">{balanceLabel(row?.outstandingAllTime ?? 0)}</span><strong className="metric-value">{money(Math.abs(row?.outstandingAllTime ?? 0), currency, language)}</strong></div>
      </div>
      <p className="small text-body-secondary stat-strip-note">{t('contributionHint')}</p>

      <section className="section-gap">
        <SectionHeader title={t('settlements')} action={<button className="btn btn-sm btn-primary" onClick={() => { setEditingSettlement(null); setSettlementOpen(true); }}><i className="bi bi-plus-lg me-1" />{t('addSettlement')}</button>} />
        {settlements.length ? <div className="data-list">{settlements.map((settlement, index) => (
          <div className="data-row p-0 reveal" style={stagger(index)} key={settlement.id}>
            <button className="data-row-action px-3 py-2" onClick={() => { setEditingSettlement(settlement); setSettlementOpen(true); }}>
              <span className={`row-icon tone-${statusTone[settlement.status]}`}><i className="bi bi-calendar-week" /></span>
              <span className="data-row-main"><span className="data-row-title">{t('weekOf').replace('{date}', localDate(settlement.weekStart, language))}</span><span className="data-row-subtitle">{settlement.vehicleLabel ?? '-'} · {balanceLabel(settlement.netAmount)} {money(Math.abs(settlement.netAmount), settlement.currency, language)}</span></span>
              <StatusPill tone={statusTone[settlement.status]}>{statusLabel[settlement.status]}</StatusPill>
              {Math.abs(settlement.outstandingAmount) > 0.005 && <strong className="text-tabular text-nowrap">{money(Math.abs(settlement.outstandingAmount), settlement.currency, language)}</strong>}
            </button>
            {settlement.status !== 'paid' && <button className="btn btn-sm btn-outline-secondary settlement-mark-paid" disabled={markingId === settlement.id} onClick={() => void markPaid(settlement)}><i className="bi bi-check2 me-sm-1" /><span className="d-none d-sm-inline">{t('markPaid')}</span><span className="visually-hidden d-sm-none">{t('markPaid')}</span></button>}
            <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="icon-button danger me-2" onConfirm={async () => { await deleteSettlement(settlement.id); await reload(); toast(t('deletedItem')); }}><i className="bi bi-trash" /><span className="visually-hidden">{t('delete')}</span></ConfirmButton>
          </div>
        ))}</div> : <div className="app-panel"><Empty icon="bi-calendar-week" title={t('noSettlements')} /></div>}
      </section>

      <section className="section-gap">
        <SectionHeader title={t('assignmentHistory')} />
        {assignments.length ? <div className="data-list">{assignments.map((assignment) => (
          <div className="data-row" key={assignment.id}>
            <span className="row-icon"><i className="bi bi-car-front" /></span>
            <span className="data-row-main"><span className="data-row-title">{assignment.vehicleLabel}</span><span className="data-row-subtitle">{localDate(assignment.startsOn, language)} - {assignment.endsOn ? localDate(assignment.endsOn, language) : t('current')}</span></span>
            {!assignment.endsOn && <StatusPill tone="brand">{t('current')}</StatusPill>}
            <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="icon-button danger" onConfirm={async () => { await deleteAssignment(assignment.id); await reload(); toast(t('deletedItem')); }}><i className="bi bi-trash" /><span className="visually-hidden">{t('delete')}</span></ConfirmButton>
          </div>
        ))}</div> : <div className="app-panel"><Empty icon="bi-car-front" title={t('noVehicleAssigned')} /></div>}
      </section>

      <div className="border-top pt-4"><ConfirmButton title={t('deleteDriver')} message={t('confirmDeleteDriver')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-outline-danger" onConfirm={async () => { await deleteDriver(driver.id); router.push('/drivers'); }}>{t('deleteDriver')}</ConfirmButton></div>

      <DriverForm show={editing} driver={driver} onClose={() => setEditing(false)} onSave={async () => { await reload(); toast(t('driverSaved')); }} />
      <AssignVehicleForm show={assigning} driverId={driver.id} cars={cars} currentCarId={current?.carId ?? null} onClose={() => setAssigning(false)} onSaved={async () => { await reload(); toast(t('assigned')); }} />
      <EndAssignmentForm assignment={ending} onClose={() => setEnding(null)} onSaved={async () => { await reload(); toast(t('assignmentEnded')); }} />
      <SettlementForm show={settlementOpen} driverId={driver.id} settlement={editingSettlement} cars={cars} defaultCarId={current?.carId ?? null} onClose={() => setSettlementOpen(false)} onSaved={async () => { await reload(); toast(t('settlementSaved')); }} />
    </>}
  </AppShell>;
}
