'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DateField } from '@/components/date-field';
import { commissionFor } from '@/components/driver-forms';
import { FileDrop } from '@/components/file-drop';
import { useAuth, useSettings } from '@/components/providers';
import { ErrorAlert, ListSkeleton, PageHeader, SectionHeader, StatusPill, useToast } from '@/components/ui';
import { getCars, type Car, type Currency } from '@/lib/database';
import { createSettlement, getCurrentAssignments, getDrivers, getSettlementsForWeek, rememberPlatformNames, settlementNet, updateSettlement, type Assignment, type Driver, type Settlement, type SettlementInput } from '@/lib/drivers';
import { chargeAmount, getFines, linkFinesToSettlement, type Fine } from '@/lib/fines';
import { addDays, localDate, mondayOf, money, today } from '@/lib/format';
import { guessMapping, matchDriver, parseCsv, savedMapping, saveMapping, totalsByDriver, type ColumnMapping, type CsvTable, type Platform } from '@/lib/platform-import';

type Upload = { fileName: string; table: CsvTable; mapping: ColumnMapping };
type Row = {
  driver: Driver; bolt: number; uber: number; cash: number; existing: Settlement | null; fines: Fine[];
  input: SettlementInput; skipped: 'currency' | null;
};
const PLATFORMS: Platform[] = ['bolt', 'uber'];
const round = (value: number) => Math.round(value * 100) / 100;

export default function ImportEarningsPage() {
  const { t, language, currency: displayCurrency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [week, setWeek] = useState(addDays(mondayOf(today()), -7));
  const [currency, setCurrency] = useState<Currency>(displayCurrency);
  const [uploads, setUploads] = useState<Partial<Record<Platform, Upload>>>({});
  const [files, setFiles] = useState<Partial<Record<Platform, File | null>>>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [existing, setExisting] = useState<Settlement[]>([]);
  const [openFines, setOpenFines] = useState<Fine[]>([]);
  /** Platform name -> chosen driver id ('' = skip), for names that did not match automatically. */
  const [manual, setManual] = useState<Record<string, string>>({});
  /** Per-driver include/exclude choices; by default weeks that already have money settled are left alone. */
  const [choices, setChoices] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(undefined);
    try {
      const [nextDrivers, nextCars, nextAssignments, nextFines] = await Promise.all([getDrivers(), getCars(), getCurrentAssignments(), getFines()]);
      setDrivers(nextDrivers); setCars(nextCars); setAssignments(nextAssignments);
      setOpenFines(nextFines.filter((fine) => fine.chargeDriver && fine.driverId !== null && fine.settlementId === null));
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getSettlementsForWeek(week).then((value) => { if (!cancelled) setExisting(value); }).catch(setError);
    return () => { cancelled = true; };
  }, [user, week]);

  async function readFile(platform: Platform, file: File | null) {
    setFiles((current) => ({ ...current, [platform]: file }));
    if (!file) { setUploads((current) => ({ ...current, [platform]: undefined })); return; }
    const table = parseCsv(await file.text());
    if (!table.headers.length) { toast(t('csvEmpty'), 'error'); return; }
    setUploads((current) => ({ ...current, [platform]: { fileName: file.name, table, mapping: savedMapping(platform, table.headers) ?? guessMapping(table.headers) } }));
  }
  function setMapping(platform: Platform, patch: Partial<ColumnMapping>) {
    setUploads((current) => {
      const upload = current[platform];
      return upload ? { ...current, [platform]: { ...upload, mapping: { ...upload.mapping, ...patch } } } : current;
    });
  }

  const totals = useMemo(() => PLATFORMS.flatMap((platform) => {
    const upload = uploads[platform];
    return upload ? totalsByDriver(upload.table, upload.mapping).map((total) => ({ ...total, platform })) : [];
  }), [uploads]);

  const resolved = useMemo(() => totals.map((total) => {
    const choice = manual[total.name];
    const driver = choice !== undefined ? drivers.find((value) => String(value.id) === choice) ?? null : matchDriver(total.name, drivers);
    return { ...total, driver, manual: choice !== undefined };
  }), [totals, manual, drivers]);
  const unmatched = resolved.filter((total) => !total.driver && !total.manual);
  const skippedNames = resolved.filter((total) => !total.driver && total.manual);

  const rows = useMemo(() => {
    const byDriver = new Map<number, Row>();
    resolved.forEach((total) => {
      if (!total.driver) return;
      const row = byDriver.get(total.driver.id) ?? { driver: total.driver, bolt: 0, uber: 0, cash: 0 } as Row;
      row[total.platform] += total.earnings; row.cash += total.cash;
      byDriver.set(total.driver.id, row);
    });
    return [...byDriver.values()].map((row): Row => {
      const driver = row.driver;
      const current = existing.find((value) => value.driverId === driver.id) ?? null;
      const fines = openFines.filter((fine) => fine.driverId === driver.id && fine.currency === currency);
      // Platform refunds can make a week negative; the database keeps earnings >= 0, so the rest goes to the adjustment.
      const bolt = Math.max(round(row.bolt), 0); const uber = Math.max(round(row.uber), 0);
      const negative = Math.min(round(row.bolt), 0) + Math.min(round(row.uber), 0);
      const assignment = assignments.find((value) => value.driverId === driver.id);
      const car = cars.find((value) => value.id === (current?.carId ?? assignment?.carId));
      const input: SettlementInput = {
        driverId: driver.id, carId: car?.id ?? null, vehicleLabel: car ? `${car.brand} ${car.model} (${car.year})` : current?.vehicleLabel ?? null,
        weekStart: week, dueDate: current?.dueDate ?? addDays(week, 7), currency,
        boltEarnings: bolt, uberEarnings: uber, bonuses: current?.bonuses ?? 0,
        manualAdjustment: round(negative - row.cash),
        fleetCommission: driver.commissionRate !== null ? commissionFor(bolt + uber, driver.commissionRate) : current?.fleetCommission ?? 0,
        vehicleRent: current?.vehicleRent || driver.weeklyRent || 0,
        expenses: current?.expenses ?? 0,
        fines: round((current?.fines ?? 0) + fines.reduce((sum, fine) => sum + chargeAmount(fine), 0)),
        amountSettled: current?.amountSettled ?? 0,
        notes: [current?.notes, row.cash > 0 ? `${t('cashCollected')}: ${money(row.cash, currency, language)}` : null].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ') || null,
      };
      return { driver, bolt, uber, cash: round(row.cash), existing: current, fines, input, skipped: current && current.currency !== currency ? 'currency' : null };
    }).sort((a, b) => a.driver.fullName.localeCompare(b.driver.fullName));
  }, [resolved, existing, openFines, assignments, cars, currency, week, t, language]);
  const isIncluded = (row: Row) => !row.skipped && (choices[row.driver.id] ?? !(row.existing && row.existing.amountSettled > 0));
  const importable = rows.filter(isIncluded);

  async function runImport() {
    setBusy(true); setError(undefined);
    try {
      for (const row of importable) {
        const id = row.existing ? (await updateSettlement(row.existing.id, row.input), row.existing.id) : await createSettlement(row.input);
        await linkFinesToSettlement(row.fines.map((fine) => fine.id), id);
      }
      // Learn the spellings the user matched by hand, so the next import needs no choices.
      const learned = new Map<number, string[]>();
      resolved.filter((total) => total.manual && total.driver).forEach((total) => learned.set(total.driver!.id, [...(learned.get(total.driver!.id) ?? []), total.name]));
      for (const [driverId, names] of learned) {
        const driver = drivers.find((value) => value.id === driverId);
        if (driver) await rememberPlatformNames(driver, names);
      }
      PLATFORMS.forEach((platform) => { const upload = uploads[platform]; if (upload) saveMapping(platform, upload.table.headers, upload.mapping); });
      toast(t('importDone').replace('{n}', String(importable.length)));
      router.push('/drivers');
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  const columnSelect = (platform: Platform, label: string, key: keyof ColumnMapping, headers: string[], optional = true) => {
    const upload = uploads[platform]!;
    // A single name column is stored as `name`; a split name as first + last.
    const value = key === 'firstName' ? upload.mapping.name ?? upload.mapping.firstName : upload.mapping[key];
    return <div className="col-sm-6 col-lg-3"><label className="form-label" htmlFor={`${platform}-${key}`}>{label}</label><select id={`${platform}-${key}`} className="form-select form-select-sm" value={value ?? ''} onChange={(event) => {
      const next = event.target.value === '' ? null : Number(event.target.value);
      if (key === 'firstName') setMapping(platform, upload.mapping.lastName === null ? { name: next, firstName: null } : { firstName: next, name: null });
      else if (key === 'lastName') setMapping(platform, next === null ? { name: upload.mapping.name ?? upload.mapping.firstName, firstName: null, lastName: null } : { firstName: upload.mapping.name ?? upload.mapping.firstName, name: null, lastName: next });
      else setMapping(platform, { [key]: next });
    }}>{optional && <option value="">-</option>}{headers.map((header, index) => <option key={`${index}-${header}`} value={index}>{header || `#${index + 1}`}</option>)}</select></div>;
  };

  return <AppShell>
    <PageHeader back={<Link href="/drivers" className="back-link"><i className="bi bi-arrow-left" />{t('drivers')}</Link>} title={t('importEarnings')} subtitle={t('importSubtitle')} />
    {Boolean(error) && <ErrorAlert error={error} />}
    {loading ? <ListSkeleton rows={3} /> : <>
      <div className="app-panel app-panel-body section-gap"><div className="row g-3 align-items-end">
        <div className="col-sm-6"><label className="form-label required" htmlFor="import-week">{t('weekStart')}</label><DateField id="import-week" max={today()} value={week} onChange={(value) => setWeek(mondayOf(value))} /><div className="form-text">{localDate(week, language)} - {localDate(addDays(week, 6), language)}</div></div>
        <div className="col-sm-6"><label className="form-label" htmlFor="import-currency">{t('currency')}</label><select id="import-currency" className="form-select" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select><div className="form-text">{t('importCurrencyHint')}</div></div>
      </div></div>

      {PLATFORMS.map((platform) => {
        const upload = uploads[platform];
        return <section className="section-gap" key={platform}>
          <SectionHeader title={t(platform === 'bolt' ? 'boltExport' : 'uberExport')} />
          <div className="app-panel app-panel-body">
            <FileDrop id={`${platform}-file`} accept=".csv,text/csv" hint={t(platform === 'bolt' ? 'boltExportHint' : 'uberExportHint')} file={files[platform] ?? null} onFile={(file) => void readFile(platform, file)} />
            {upload && <div className="row g-3 mt-1">
              {columnSelect(platform, t('columnDriverName'), 'firstName', upload.table.headers, false)}
              {columnSelect(platform, t('columnLastName'), 'lastName', upload.table.headers)}
              {columnSelect(platform, t('columnEarnings'), 'earnings', upload.table.headers, false)}
              {columnSelect(platform, t('columnCash'), 'cash', upload.table.headers)}
              <div className="col-12"><p className="form-text mb-0">{t('csvSummary').replace('{rows}', String(upload.table.rows.length)).replace('{drivers}', String(totals.filter((total) => total.platform === platform).length))}</p></div>
            </div>}
          </div>
        </section>;
      })}

      {unmatched.length > 0 && <section className="section-gap">
        <SectionHeader title={t('matchDrivers')} />
        <div className="app-panel app-panel-body"><p className="small text-body-secondary">{t('matchDriversHint')}</p><div className="row g-3">{unmatched.map((total) => (
          <div className="col-md-6" key={`${total.platform}-${total.name}`}><label className="form-label" htmlFor={`match-${total.platform}-${total.name}`}>{total.name} <span className="text-body-secondary fw-normal">· {total.platform === 'bolt' ? 'Bolt' : 'Uber'} · {money(total.earnings, currency, language)}</span></label>
            <select id={`match-${total.platform}-${total.name}`} className="form-select" value={manual[total.name] ?? ''} onChange={(event) => setManual((current) => ({ ...current, [total.name]: event.target.value }))}>
              <option value="" disabled>{t('chooseDriver')}</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}<option value="skip">{t('skipName')}</option>
            </select></div>
        ))}</div></div>
      </section>}

      {rows.length > 0 && <section className="section-gap">
        <SectionHeader title={t('importPreview')} action={skippedNames.length > 0 && <span className="small text-body-secondary">{t('namesSkipped').replace('{n}', String(skippedNames.length))}</span>} />
        <div className="app-panel import-table-wrap"><table className="import-table">
          <thead><tr><th scope="col"><span className="visually-hidden">{t('include')}</span></th><th scope="col">{t('driver')}</th><th scope="col" className="num">Bolt</th><th scope="col" className="num">Uber</th><th scope="col" className="num">{t('cashCollected')}</th><th scope="col" className="num">{t('fleetCommission')}</th><th scope="col" className="num">{t('vehicleRent')}</th><th scope="col" className="num">{t('fines')}</th><th scope="col" className="num">{t('payoutToDriver')}</th><th scope="col"></th></tr></thead>
          <tbody>{rows.map((row) => {
            const net = settlementNet(row.input); const included = isIncluded(row);
            return <tr key={row.driver.id} className={included ? '' : 'is-excluded'}>
              <td><input type="checkbox" className="form-check-input" aria-label={`${t('include')} ${row.driver.fullName}`} disabled={Boolean(row.skipped)} checked={included} onChange={(event) => setChoices((current) => ({ ...current, [row.driver.id]: event.target.checked }))} /></td>
              <th scope="row">{row.driver.fullName}{row.input.vehicleLabel && <span className="d-block small text-body-secondary fw-normal">{row.input.vehicleLabel}</span>}</th>
              <td className="num">{money(row.bolt, currency, language)}</td>
              <td className="num">{money(row.uber, currency, language)}</td>
              <td className="num">{row.cash ? `-${money(row.cash, currency, language)}` : '-'}</td>
              <td className="num">{money(row.input.fleetCommission, currency, language)}</td>
              <td className="num">{money(row.input.vehicleRent, currency, language)}</td>
              <td className="num">{row.input.fines ? money(row.input.fines, currency, language) : '-'}{row.fines.length > 0 && <span className="d-block small text-body-secondary">+{row.fines.length} {t('open').toLowerCase()}</span>}</td>
              <td className={`num fw-semibold ${net < 0 ? 'text-danger' : ''}`}>{net < 0 ? `-${money(-net, currency, language)}` : money(net, currency, language)}</td>
              <td>{row.skipped ? <StatusPill tone="danger">{t('currencyMismatch')}</StatusPill> : row.existing && row.existing.amountSettled > 0 ? <StatusPill tone="warning">{t('alreadySettled')}</StatusPill> : row.existing ? <StatusPill tone="info">{t('updatesWeek')}</StatusPill> : <StatusPill tone="success">{t('newWeek')}</StatusPill>}{row.existing && row.existing.amountSettled > 0 && <span className="d-block small text-body-secondary mt-1">{t('settledAmount').replace('{amount}', money(row.existing.amountSettled, row.existing.currency, language))}</span>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {rows.some((row) => row.driver.commissionRate === null || row.driver.weeklyRent === null) && <p className="small text-body-secondary mt-3 mb-0">{t('importTermsHint')}</p>}
        <div className="d-flex justify-content-end gap-2 mt-4">
          <Link href="/drivers" className="btn btn-outline-secondary">{t('cancel')}</Link>
          <button className="btn btn-primary" disabled={busy || !importable.length || unmatched.length > 0} onClick={() => void runImport()}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('importWeeks').replace('{n}', String(importable.length))}</button>
        </div>
        {unmatched.length > 0 && <p className="small text-warning text-end mt-2 mb-0">{t('matchAllFirst')}</p>}
      </section>}
    </>}
  </AppShell>;
}
