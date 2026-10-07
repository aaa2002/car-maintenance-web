'use client';

import type { Car } from '@/lib/database';
import type { Driver } from '@/lib/drivers';
import { carLabel } from '@/lib/fleet';
import { deleteFine, discountOpen, markDriverNamed, needsDriverNamed, type Fine } from '@/lib/fines';
import { daysUntil, localDate, money, today } from '@/lib/format';
import { useSettings } from './providers';
import { ConfirmButton, stagger, StatusPill, useToast } from './ui';

/** What the police need when the owner names the driver of a camera fine. */
function driverStatement(fine: Fine, car: Car | undefined, driver: Driver | undefined, language: 'en' | 'ro') {
  const [date, time] = fine.offenseAt.split('T');
  return [
    fine.reference && `${language === 'ro' ? 'Proces-verbal' : 'Report'}: ${fine.reference}`,
    `${language === 'ro' ? 'Data faptei' : 'Offense'}: ${localDate(date, language)} ${time}`,
    car && `${language === 'ro' ? 'Vehicul' : 'Vehicle'}: ${car.brand} ${car.model}${car.plateNumber ? `, ${car.plateNumber}` : ''}`,
    driver && `${language === 'ro' ? 'Conducător auto' : 'Driver'}: ${driver.fullName}`,
    driver?.licenseNumber && `${language === 'ro' ? 'Permis' : 'Licence'}: ${driver.licenseNumber}`,
    driver?.phone && `${language === 'ro' ? 'Telefon' : 'Phone'}: ${driver.phone}`,
    driver?.email && `E-mail: ${driver.email}`,
  ].filter(Boolean).join('\n');
}

export function FineList({ fines, cars, drivers, showCar = true, showDriver = true, onEdit, onPay, onChanged }: {
  fines: Fine[]; cars: Car[]; drivers: Driver[]; showCar?: boolean; showDriver?: boolean;
  onEdit: (fine: Fine) => void; onPay: (fine: Fine) => void; onChanged: () => Promise<void>;
}) {
  const { t, language } = useSettings();
  const { toast } = useToast();
  const carMap = new Map(cars.map((car) => [car.id, car]));
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

  async function copyStatement(fine: Fine) {
    try { await navigator.clipboard.writeText(driverStatement(fine, carMap.get(fine.carId), fine.driverId ? driverMap.get(fine.driverId) : undefined, language)); toast(t('driverDetailsCopied')); }
    catch { toast(t('copyFailed'), 'error'); }
  }

  return <div className="data-list">{fines.map((fine, index) => {
    const car = carMap.get(fine.carId); const driver = fine.driverId ? driverMap.get(fine.driverId) : undefined;
    const [date, time] = fine.offenseAt.split('T');
    const discount = discountOpen(fine) ? daysUntil(fine.discountUntil!) : null;
    const naming = needsDriverNamed(fine);
    const tone = fine.paidOn ? (naming ? 'warning' : 'success') : discount !== null && discount <= 3 ? 'danger' : 'warning';
    const subtitle = [showCar && car ? carLabel(car) : null, showDriver ? driver?.fullName ?? t('fleetPays') : null, `${localDate(date, language)} ${time}`].filter(Boolean).join(' · ');
    return (
      <div className="data-row fine-row p-0 reveal" style={stagger(index)} key={fine.id}>
        <button className="data-row-action px-3 py-2" onClick={() => onEdit(fine)}>
          <span className={`row-icon tone-${tone}`}><i className={`bi ${fine.kind === 'camera' ? 'bi-camera' : fine.kind === 'parking' ? 'bi-p-square' : 'bi-receipt'}`} /></span>
          <span className="data-row-main">
            <span className="data-row-title">{t(`fineKind_${fine.kind}` as const)}{fine.reference ? ` · ${fine.reference}` : ''}</span>
            <span className="data-row-subtitle">{subtitle}</span>
          </span>
          <span className="fine-pills">
            {fine.paidOn ? <StatusPill tone="success">{t('finePaid')}</StatusPill>
              : discount !== null ? <StatusPill tone={discount <= 3 ? 'danger' : 'warning'}>{discount === 0 ? t('halfPriceToday') : t('halfPriceDays').replace('{n}', String(discount))}</StatusPill>
              : <StatusPill tone="danger">{t('fineUnpaid')}</StatusPill>}
            {naming && <StatusPill tone="warning">{t('nameDriver')}</StatusPill>}
            {fine.chargeDriver && fine.driverId && <StatusPill tone={fine.settlementId ? 'neutral' : 'info'}>{fine.settlementId ? t('deducted') : t('toDeduct')}</StatusPill>}
          </span>
          <strong className="text-tabular text-nowrap">{money(fine.paidAmount ?? fine.amount, fine.currency, language)}</strong>
        </button>
        <span className="fine-actions">
          {!fine.paidOn && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onPay(fine)}><i className="bi bi-check2 me-sm-1" /><span className="d-none d-sm-inline">{t('markFinePaid')}</span><span className="visually-hidden d-sm-none">{t('markFinePaid')}</span></button>}
          {naming && driver && <button type="button" className="icon-button" title={t('copyDriverDetails')} onClick={() => void copyStatement(fine)}><i className="bi bi-clipboard" /><span className="visually-hidden">{t('copyDriverDetails')}</span></button>}
          {naming && <button type="button" className="icon-button" title={t('markDriverNamed')} onClick={async () => { await markDriverNamed(fine.id, today()); await onChanged(); toast(t('driverNamedSaved')); }}><i className="bi bi-person-check" /><span className="visually-hidden">{t('markDriverNamed')}</span></button>}
          <ConfirmButton message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="icon-button danger" onConfirm={async () => { await deleteFine(fine); await onChanged(); toast(t('deletedItem')); }}><i className="bi bi-trash" /><span className="visually-hidden">{t('delete')}</span></ConfirmButton>
        </span>
      </div>
    );
  })}</div>;
}
