'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, StatusPill, useToast } from '@/components/ui';
import { getDriver, getSettlementsForDriver, type Driver, type Settlement } from '@/lib/drivers';
import { chargeAmount, getFinesForSettlement, type Fine } from '@/lib/fines';
import { addDays, localDate, money } from '@/lib/format';

/** A driver's weekly statement: printable (Save as PDF) and shareable as plain text. */
export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const driverId = Number(id);
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [fines, setFines] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    if (!user || !Number.isInteger(driverId)) return;
    setError(undefined);
    try {
      const week = new URLSearchParams(location.search).get('week');
      const [nextDriver, settlements] = await Promise.all([getDriver(driverId), getSettlementsForDriver(driverId)]);
      const found = settlements.find((value) => value.weekStart === week) ?? settlements[0] ?? null;
      setDriver(nextDriver); setSettlement(found);
      setFines(found ? await getFinesForSettlement(found.id) : []);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, driverId]);
  useEffect(() => { void load(); }, [load]);

  const fleetName = (user?.user_metadata.display_name as string | undefined) || user?.email || '';
  const format = (value: number) => (settlement ? money(value, settlement.currency, language) : '');
  const lines = settlement ? [
    { label: t('boltEarnings'), value: settlement.boltEarnings },
    { label: t('uberEarnings'), value: settlement.uberEarnings },
    { label: t('bonuses'), value: settlement.bonuses },
    { label: t('adjustment'), value: settlement.manualAdjustment },
    { label: t('fleetCommission'), value: -settlement.fleetCommission },
    { label: t('vehicleRent'), value: -settlement.vehicleRent },
    { label: t('expenses'), value: -settlement.expenses },
    { label: t('fines'), value: -settlement.fines },
  ].filter((line) => Math.abs(line.value) > 0.005) : [];
  const netLabel = settlement && settlement.netAmount < 0 ? t('driverOwes') : t('payoutToDriver');
  const weekLabel = settlement ? `${localDate(settlement.weekStart, language)} - ${localDate(addDays(settlement.weekStart, 6), language)}` : '';

  function plainText() {
    if (!settlement || !driver) return '';
    return [
      `${t('weeklyStatement')} · ${driver.fullName}`,
      weekLabel,
      settlement.vehicleLabel ?? '',
      '',
      ...lines.map((line) => `${line.label}: ${format(line.value)}`),
      ...fines.map((fine) => `  - ${localDate(fine.offenseAt.split('T')[0], language)}${fine.reference ? ` ${fine.reference}` : ''}: ${money(chargeAmount(fine), fine.currency, language)}`),
      '',
      `${netLabel}: ${format(Math.abs(settlement.netAmount))}`,
      `${t('amountSettled')}: ${format(settlement.amountSettled)}`,
      `${t('outstanding')}: ${format(Math.abs(settlement.outstandingAmount))}`,
      `${t('dueDate')}: ${localDate(settlement.dueDate, language)}`,
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
  }
  async function copy() {
    try { await navigator.clipboard.writeText(plainText()); toast(t('statementCopied')); }
    catch { toast(t('copyFailed'), 'error'); }
  }
  const mailto = driver?.email && settlement ? `mailto:${driver.email}?subject=${encodeURIComponent(`${t('weeklyStatement')} ${weekLabel}`)}&body=${encodeURIComponent(plainText())}` : null;
  const statusTone = { paid: 'success', partial: 'warning', unpaid: 'danger' } as const;
  const statusLabel = { paid: t('settlementPaid'), partial: t('settlementPartial'), unpaid: t('settlementUnpaid') } as const;

  return <AppShell>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}
    {loading ? <ListSkeleton rows={6} /> : !driver || !settlement ? <div className="app-panel"><Empty icon="bi-file-earmark-text" title={t('noSettlements')} action={<Link href={`/drivers/${driverId}`} className="btn btn-primary">{t('drivers')}</Link>} /></div> : <>
      <div className="statement-toolbar no-print">
        <Link href={`/drivers/${driver.id}`} className="back-link"><i className="bi bi-arrow-left" />{driver.fullName}</Link>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => void copy()}><i className="bi bi-clipboard me-2" />{t('copyText')}</button>
          {mailto && <a className="btn btn-sm btn-outline-secondary" href={mailto}><i className="bi bi-envelope me-2" />{t('emailDriver')}</a>}
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}><i className="bi bi-printer me-2" />{t('printOrPdf')}</button>
        </div>
      </div>

      <article className="app-panel statement">
        <header className="statement-header">
          <div>
            <span className="metric-label">{t('weeklyStatement')}</span>
            <h1 className="statement-title">{driver.fullName}</h1>
            <p className="text-body-secondary mb-0">{weekLabel}{settlement.vehicleLabel ? ` · ${settlement.vehicleLabel}` : ''}</p>
          </div>
          <div className="text-sm-end">
            <span className="metric-label d-block">{t('issuedBy')}</span>
            <strong className="d-block">{fleetName}</strong>
            <StatusPill tone={statusTone[settlement.status]}>{statusLabel[settlement.status]}</StatusPill>
          </div>
        </header>

        <table className="statement-table">
          <tbody>
            {lines.map((line) => <tr key={line.label}><th scope="row">{line.label}</th><td className="num">{format(line.value)}</td></tr>)}
            {fines.map((fine) => <tr key={fine.id} className="statement-sub"><th scope="row">{localDate(fine.offenseAt.split('T')[0], language)} {fine.offenseAt.split('T')[1]}{fine.reference ? ` · ${fine.reference}` : ''}</th><td className="num">{money(chargeAmount(fine), fine.currency, language)}</td></tr>)}
          </tbody>
          <tfoot>
            <tr className="statement-total"><th scope="row">{netLabel}</th><td className="num">{format(Math.abs(settlement.netAmount))}</td></tr>
            <tr><th scope="row">{t('amountSettled')}</th><td className="num">{format(settlement.amountSettled)}</td></tr>
            <tr><th scope="row">{t('outstanding')}</th><td className="num">{format(Math.abs(settlement.outstandingAmount))}</td></tr>
            <tr><th scope="row">{t('dueDate')}</th><td>{localDate(settlement.dueDate, language)}</td></tr>
          </tfoot>
        </table>
        {settlement.notes && <p className="small text-body-secondary mb-0 mt-3">{settlement.notes}</p>}
      </article>
    </>}
  </AppShell>;
}
