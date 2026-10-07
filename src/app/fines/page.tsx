'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { FineList } from '@/components/fine-list';
import { FineForm, FinePaidForm } from '@/components/fine-forms';
import { useAuth, useSettings } from '@/components/providers';
import { Empty, ErrorAlert, ListSkeleton, PageHeader, SectionHeader, useToast } from '@/components/ui';
import { getCars, type Car } from '@/lib/database';
import { getDrivers, type Driver } from '@/lib/drivers';
import { chargeAmount, discountOpen, getFines, needsDriverNamed, type Fine } from '@/lib/fines';
import { money } from '@/lib/format';

const isOpen = (fine: Fine) => !fine.paidOn || needsDriverNamed(fine) || (fine.chargeDriver && fine.driverId !== null && fine.settlementId === null);

export default function FinesPage() {
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [fines, setFines] = useState<Fine[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<Fine | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [paying, setPaying] = useState<Fine | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(undefined);
    try {
      const [nextFines, nextCars, nextDrivers] = await Promise.all([getFines(), getCars(), getDrivers()]);
      setFines(nextFines); setCars(nextCars); setDrivers(nextDrivers);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  // Totals in RON only; EUR fines are rare and listed as they are.
  const totals = useMemo(() => {
    const ron = fines.filter((fine) => fine.currency === 'RON');
    return {
      unpaid: ron.filter((fine) => !fine.paidOn).reduce((sum, fine) => sum + fine.amount, 0),
      savings: ron.filter(discountOpen).reduce((sum, fine) => sum + fine.amount / 2, 0),
      toDeduct: ron.filter((fine) => fine.chargeDriver && fine.driverId !== null && fine.settlementId === null).reduce((sum, fine) => sum + chargeAmount(fine), 0),
      naming: fines.filter(needsDriverNamed).length,
    };
  }, [fines]);
  const visible = filter === 'open' ? fines.filter(isOpen) : fines;

  return (
    <AppShell>
      <PageHeader
        title={t('fines')}
        subtitle={t('finesSubtitle')}
        action={<button className="btn btn-primary btn-island" disabled={!cars.length} onClick={() => { setEditing(null); setFormOpen(true); }} aria-label={t('addFine')}><span className="d-none d-sm-inline">{t('addFine')}</span><span className="btn-island-icon"><i className="bi bi-plus-lg" /></span></button>}
      />
      {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}

      {fines.length > 0 && (
        <div className="app-panel stat-strip">
          <div className="stat-item"><span className="metric-label">{t('fineUnpaid')}</span><strong className="metric-value">{money(totals.unpaid, 'RON', language)}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('halfPriceSavings')}</span><strong className="metric-value">{money(totals.savings, 'RON', language)}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('toDeduct')}</span><strong className="metric-value">{money(totals.toDeduct, 'RON', language)}</strong></div>
          <div className="stat-item"><span className="metric-label">{t('nameDriver')}</span><strong className={`metric-value ${totals.naming ? 'text-warning' : ''}`}>{totals.naming}</strong></div>
        </div>
      )}

      <section>
        <SectionHeader title={t('fines')} action={<div className="segmented">{(['open', 'all'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'open' ? t('openFines') : t('allFines')}</button>)}</div>} />
        {loading ? <ListSkeleton rows={3} /> : visible.length
          ? <FineList fines={visible} cars={cars} drivers={drivers} onEdit={(fine) => { setEditing(fine); setFormOpen(true); }} onPay={setPaying} onChanged={load} />
          : <div className="app-panel"><Empty icon="bi-receipt" title={fines.length ? t('noOpenFines') : t('noFines')} text={t('noFinesHint')} action={cars.length ? <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>{t('addFine')}</button> : undefined} /></div>}
        {fines.length > 0 && <p className="small text-body-secondary mt-3 mb-0">{t('finesHint')}</p>}
      </section>

      <FineForm show={formOpen} fine={editing} cars={cars} drivers={drivers} onClose={() => setFormOpen(false)} onSaved={async () => { await load(); toast(t('fineSaved')); }} />
      <FinePaidForm fine={paying} onClose={() => setPaying(null)} onSaved={async () => { await load(); toast(t('fineSaved')); }} />
    </AppShell>
  );
}
