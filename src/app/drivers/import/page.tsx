'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { DateField } from '@/components/date-field';
import { commissionFor } from '@/components/driver-forms';
import { DriverSubnav } from '@/components/driver-subnav';
import { useAuth, useSettings } from '@/components/providers';
import { ErrorAlert, ListSkeleton, PageHeader, SectionHeader, SetupBanner, StatusPill, useToast } from '@/components/ui';
import { getCars, type Car, type Currency } from '@/lib/database';
import { createSettlement, getCurrentAssignments, getDrivers, getSettlementsForWeek, updateDriver, updateSettlement, type Assignment, type Driver, type Settlement, type SettlementInput } from '@/lib/drivers';
import { chargeAmount, getFines, linkFinesToSettlement, type Fine } from '@/lib/fines';
import { addDays, errorMessage, localDate, mondayOf, money, today } from '@/lib/format';
import { createDriverFromIdentities, createImport, existingInvoiceNumbers, getImportsByHash, getPlatformEarnings, invoiceTotals, learnIdentity, matchIdentity, saveEarnings, saveRideInvoices, similarNames, type ImportRecord, type MatchReason, type PlatformEarning } from '@/lib/imports';
import { invoiceWeek, readPlatformFile, weekEnd, type DriverIdentity, type EarningsRow, type InvoiceIssueReason, type ParsedFile, type RideInvoice } from '@/lib/platform-files';
import { nameKey, type Platform } from '@/lib/platform-import';
import type { StringKey } from '@/i18n/strings';

type LoadedFile = {
  id: string; name: string; size: number; parsed: ParsedFile | null; error: unknown; progress: { done: number; total: number } | null;
  /** Earlier imports of this exact file. */
  previous: ImportRecord[];
  /** Invoice numbers from this file that are already stored. */
  stored: Set<string>;
};
type Detected = DriverIdentity & { key: string; earnings: boolean; invoices: number };
/** What happens to a driver found in the files: an existing driver, a new one, the same person as another found name, or nothing. */
type Choice = 'new' | 'skip' | `driver:${number}` | `same:${string}`;
type InvoiceState = 'ready' | 'otherWeek' | 'stored' | 'repeated';

const PLATFORM_LABEL: Record<Platform, string> = { bolt: 'Bolt', uber: 'Uber' };
const ISSUE_LABEL: Record<InvoiceIssueReason, StringKey> = {
  unreadable: 'issueUnreadable', notPdf: 'issueNotPdf', notRideInvoice: 'issueNotRideInvoice', missingNumber: 'issueMissingNumber', missingAmount: 'issueMissingAmount',
  missingDate: 'issueMissingDate', missingDriver: 'issueMissingDriver', duplicateInFile: 'issueDuplicateInFile', currency: 'issueCurrency',
};
const MATCH_LABEL: Record<MatchReason, StringKey> = { platformId: 'matchedById', email: 'matchedByEmail', phone: 'matchedByPhone', alias: 'matchedByAlias', name: 'matchedByName' };
const round = (value: number) => Math.round(value * 100) / 100;
const identityKey = (platform: Platform, value: string) => `${platform}:${value}`;

export default function ImportPage() {
  const { t, language, currency: displayCurrency } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [week, setWeek] = useState(addDays(mondayOf(today()), -7));
  // Once the user picks a week (or a file sets it), later files no longer move it.
  const weekTouched = useRef(false);
  const chooseWeek = (value: string) => { weekTouched.current = true; setWeek(value); };
  const [currency, setCurrency] = useState<Currency>(displayCurrency);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [existing, setExisting] = useState<Settlement[]>([]);
  const [stored, setStored] = useState<PlatformEarning[]>([]);
  const [openFines, setOpenFines] = useState<Fine[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [otherWeeks, setOtherWeeks] = useState(false);
  const [weekOverride, setWeekOverride] = useState<Record<string, boolean>>({});
  const [defaultRent, setDefaultRent] = useState(''); const [defaultCommission, setDefaultCommission] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<{ step: StringKey; done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ drivers: number; weeks: number; invoices: number; skipped: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
  // Opened from another page for a given week (?week=YYYY-MM-DD).
  useEffect(() => { const value = new URLSearchParams(location.search).get('week'); if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) chooseWeek(mondayOf(value)); }, []);
  const loadWeek = useCallback(async () => {
    if (!user) return;
    try { const [nextExisting, nextStored] = await Promise.all([getSettlementsForWeek(week), getPlatformEarnings(week)]); setExisting(nextExisting); setStored(nextStored); }
    catch (caught) { setError(caught); }
  }, [user, week]);
  useEffect(() => { void loadWeek(); }, [loadWeek]);

  // ---- Reading files ------------------------------------------------------------------------------------------
  async function addFiles(list: FileList | File[]) {
    setResult(null);
    // Show every file right away; the readers (pdf.js) load while they are listed as "Reading…".
    const entries = Array.from(list).map((file) => ({ file, id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}` }));
    setFiles((current) => [...current, ...entries.map(({ file, id }) => ({ id, name: file.name, size: file.size, parsed: null, error: undefined, progress: null, previous: [], stored: new Set<string>() }))]);
    const { browserReaders } = await import('@/lib/file-readers');
    for (const { file, id } of entries) {
      const update = (patch: Partial<LoadedFile>) => setFiles((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        let last = 0;
        const parsed = await readPlatformFile(file.name, data, { ...browserReaders, onProgress: (done, total) => { if (done === total || Date.now() - last > 120) { last = Date.now(); update({ progress: { done, total } }); } } });
        const [previous, storedNumbers] = await Promise.all([
          getImportsByHash([parsed.hash]),
          parsed.kind === 'invoices' ? existingInvoiceNumbers(parsed.platform, parsed.invoices.map((invoice) => invoice.number)) : Promise.resolve(new Set<string>()),
        ]);
        update({ parsed, previous, stored: storedNumbers, progress: null });
        // The week of the first earnings export becomes the import week, unless the user already chose one.
        if (parsed.kind === 'earnings' && parsed.weekStart && !weekTouched.current) chooseWeek(parsed.weekStart);
      } catch (caught) { update({ error: caught, progress: null }); }
    }
  }
  const removeFile = (id: string) => setFiles((current) => current.filter((entry) => entry.id !== id));
  function onDrop(event: DragEvent) { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files); }

  const earningsFiles = useMemo(() => files.flatMap((file) => (file.parsed?.kind === 'earnings' ? [{ file, parsed: file.parsed }] : [])), [files]);
  const invoiceFiles = useMemo(() => files.flatMap((file) => (file.parsed?.kind === 'invoices' ? [{ file, parsed: file.parsed }] : [])), [files]);
  const reading = files.some((file) => !file.parsed && !file.error);
  const wrongWeek = earningsFiles.filter(({ file, parsed }) => parsed.weekStart && parsed.weekStart !== week && !weekOverride[file.id]);
  const sameKindTwice = (['bolt', 'uber'] as Platform[]).filter((platform) => earningsFiles.filter(({ parsed }) => parsed.platform === platform).length > 1);

  // ---- Who is in the files --------------------------------------------------------------------------------------
  const detected = useMemo(() => {
    const list: Detected[] = []; const byName = new Map<string, Detected>();
    earningsFiles.forEach(({ parsed }) => parsed.rows.forEach((row) => {
      const key = identityKey(row.platform, row.platformId ?? nameKey(row.name));
      if (list.some((entry) => entry.key === key)) return;
      const entry: Detected = { platform: row.platform, platformId: row.platformId, name: row.name, email: row.email, phone: row.phone, key, earnings: true, invoices: 0 };
      list.push(entry); byName.set(identityKey(row.platform, nameKey(row.name)), entry);
    }));
    invoiceFiles.forEach(({ parsed }) => parsed.invoices.forEach((invoice) => {
      const nameId = identityKey(invoice.platform, nameKey(invoice.driverName));
      let entry = byName.get(nameId);
      if (!entry) { entry = { platform: invoice.platform, platformId: null, name: invoice.driverName, email: null, phone: null, key: nameId, earnings: false, invoices: 0 }; list.push(entry); byName.set(nameId, entry); }
      entry.invoices += 1;
    }));
    return list;
  }, [earningsFiles, invoiceFiles]);
  const keyForInvoice = useCallback((invoice: RideInvoice) => {
    const nameId = identityKey(invoice.platform, nameKey(invoice.driverName));
    return detected.find((entry) => identityKey(entry.platform, nameKey(entry.name)) === nameId)?.key ?? nameId;
  }, [detected]);
  const keyForRow = (row: EarningsRow) => identityKey(row.platform, row.platformId ?? nameKey(row.name));

  const automatic = useMemo(() => new Map(detected.map((entry) => [entry.key, matchIdentity(entry, drivers)])), [detected, drivers]);
  /** Suggested choice for names that matched nobody: a similar existing driver, or a similar name from the other platform. */
  const suggestion = useCallback((entry: Detected): Choice => {
    const similarDriver = drivers.find((driver) => similarNames(driver.fullName, entry.name) || driver.platformNames.some((alias) => similarNames(alias, entry.name)));
    if (similarDriver) return `driver:${similarDriver.id}`;
    const index = detected.indexOf(entry);
    const twin = detected.find((other, position) => position < index && other.platform !== entry.platform && !automatic.get(other.key) && (similarNames(other.name, entry.name) || nameKey(other.name) === nameKey(entry.name)));
    return twin ? `same:${twin.key}` : 'new';
  }, [drivers, detected, automatic]);
  const choiceFor = useCallback((entry: Detected): Choice => {
    if (choices[entry.key]) return choices[entry.key];
    const auto = automatic.get(entry.key);
    return auto ? `driver:${auto.driver.id}` : suggestion(entry);
  }, [choices, automatic, suggestion]);
  /** Final destination: an existing driver id, the key of a driver to create, or null (skipped). */
  const resolve = useCallback((start: string): { driverId: number } | { newKey: string } | null => {
    // Follows "same person as" links; the step limit guards against a loop of links.
    let key = start;
    for (let step = 0; step <= detected.length; step += 1) {
      const entry = detected.find((value) => value.key === key);
      if (!entry) return null;
      const choice = choiceFor(entry);
      if (choice === 'skip') return null;
      if (choice === 'new') return { newKey: key };
      if (choice.startsWith('driver:')) return { driverId: Number(choice.slice(7)) };
      key = choice.slice(5);
    }
    return null;
  }, [detected, choiceFor]);
  const refOf = useCallback((key: string) => { const target = resolve(key); return target ? ('driverId' in target ? `driver:${target.driverId}` : `new:${target.newKey}`) : null; }, [resolve]);
  const newDrivers = detected.filter((entry) => { const target = resolve(entry.key); return target && 'newKey' in target && target.newKey === entry.key; });
  const unmatched = detected.filter((entry) => !automatic.get(entry.key));

  // ---- Weekly settlements from the earnings exports -------------------------------------------------------------
  const rent = defaultRent.trim() === '' ? null : Number(defaultRent);
  const commission = defaultCommission.trim() === '' ? null : Number(defaultCommission);
  const settlementRows = useMemo(() => {
    const byRef = new Map<string, { ref: string; name: string; driver: Driver | null; rows: Partial<Record<Platform, EarningsRow>> }>();
    earningsFiles.forEach(({ file, parsed }) => {
      if (parsed.weekStart && parsed.weekStart !== week && !weekOverride[file.id]) return;
      parsed.rows.forEach((row) => {
        const ref = refOf(keyForRow(row)); if (!ref) return;
        const driver = ref.startsWith('driver:') ? drivers.find((value) => value.id === Number(ref.slice(7))) ?? null : null;
        const current = byRef.get(ref) ?? { ref, name: driver?.fullName ?? detected.find((entry) => `new:${entry.key}` === ref)?.name ?? row.name, driver, rows: {} };
        current.rows[row.platform] = row; byRef.set(ref, current);
      });
    });
    return [...byRef.values()].map((entry) => {
      const { driver } = entry;
      const current = driver ? existing.find((value) => value.driverId === driver.id) ?? null : null;
      // A platform missing from this upload keeps what an earlier import stored for the week.
      const figure = (platform: Platform) => entry.rows[platform] ?? (driver ? stored.find((value) => value.driverId === driver.id && value.platform === platform) : undefined);
      const bolt = figure('bolt'); const uber = figure('uber');
      const boltEarnings = round(bolt?.earnings ?? current?.boltEarnings ?? 0); const uberEarnings = round(uber?.earnings ?? current?.uberEarnings ?? 0);
      const cash = bolt || uber ? round((bolt?.cash ?? 0) + (uber?.cash ?? 0)) : current?.cashCollected ?? 0;
      const fines = driver ? openFines.filter((fine) => fine.driverId === driver.id && fine.currency === currency) : [];
      const rate = driver ? driver.commissionRate : commission;
      const assignment = driver ? assignments.find((value) => value.driverId === driver.id) : undefined;
      const car = cars.find((value) => value.id === (current?.carId ?? assignment?.carId));
      const input: SettlementInput = {
        driverId: driver?.id ?? 0, carId: car?.id ?? null, vehicleLabel: car ? `${car.brand} ${car.model} (${car.year})` : current?.vehicleLabel ?? null,
        weekStart: week, dueDate: current?.dueDate ?? addDays(week, 7), currency,
        boltEarnings, uberEarnings, cashCollected: cash, bonuses: current?.bonuses ?? 0, manualAdjustment: current?.manualAdjustment ?? 0,
        fleetCommission: rate !== null && rate !== undefined ? commissionFor(boltEarnings + uberEarnings, rate) : current?.fleetCommission ?? 0,
        vehicleRent: current?.vehicleRent || (driver ? driver.weeklyRent : rent) || 0, expenses: current?.expenses ?? 0,
        fines: round((current?.fines ?? 0) + fines.reduce((sum, fine) => sum + chargeAmount(fine), 0)),
        amountSettled: current?.amountSettled ?? 0, notes: current?.notes ?? null, paidOn: current?.paidOn ?? null, paymentMethod: current?.paymentMethod ?? null,
      };
      return { ...entry, current, fines, input, blocked: current && current.currency !== currency ? 'currency' as const : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [earningsFiles, week, weekOverride, refOf, drivers, detected, existing, stored, openFines, currency, commission, rent, assignments, cars]);
  const isIncluded = (row: (typeof settlementRows)[number]) => !row.blocked && (included[row.ref] ?? !(row.current && row.current.amountSettled > 0));

  // ---- Ride invoices: what is new, what is stored, what belongs to another week ------------------------------------
  const invoicePlan = useMemo(() => {
    const seen = new Set<string>();
    return invoiceFiles.map(({ file, parsed }) => {
      const states = parsed.invoices.map((invoice) => {
        const id = `${invoice.platform}:${invoice.number}`;
        const state: InvoiceState = file.stored.has(invoice.number) ? 'stored' : seen.has(id) ? 'repeated' : invoiceWeek(invoice) !== week ? 'otherWeek' : 'ready';
        seen.add(id);
        return { invoice, state };
      });
      const count = (state: InvoiceState) => states.filter((entry) => entry.state === state).length;
      return { file, parsed, states, ready: count('ready'), otherWeek: count('otherWeek'), stored: count('stored'), repeated: count('repeated') };
    });
  }, [invoiceFiles, week]);
  const invoicesToSave = invoicePlan.flatMap((plan) => plan.states.filter((entry) => entry.state === 'ready' || (otherWeeks && entry.state === 'otherWeek')).map((entry) => entry.invoice));
  const otherWeekCount = invoicePlan.reduce((sum, plan) => sum + plan.otherWeek, 0);

  /** Invoices of the selected week per driver, set against what the earnings exports report. */
  const reconciliation = useMemo(() => {
    const map = new Map<string, Partial<Record<Platform, ReturnType<typeof invoiceTotals>>>>();
    invoicePlan.forEach((plan) => plan.states.forEach(({ invoice }) => {
      if (invoiceWeek(invoice) !== week) return;
      const ref = refOf(keyForInvoice(invoice)); if (!ref) return;
      const entry = map.get(ref) ?? {};
      const current = entry[invoice.platform] ?? { count: 0, total: 0, cash: 0, knownMethod: false };
      const add = invoiceTotals([invoice]);
      entry[invoice.platform] = { count: current.count + 1, total: current.total + add.total, cash: current.cash + add.cash, knownMethod: current.knownMethod || add.knownMethod };
      map.set(ref, entry);
    }));
    return map;
  }, [invoicePlan, week, refOf, keyForInvoice]);
  const invoiceOnlyRefs = [...reconciliation.keys()].filter((ref) => !settlementRows.some((row) => row.ref === ref));

  const importableWeeks = settlementRows.filter(isIncluded);
  const blockers: StringKey[] = [
    ...(reading ? ['stillReading' as const] : []),
    ...(wrongWeek.length ? ['resolveWeekFirst' as const] : []),
    ...(sameKindTwice.length ? ['oneExportPerPlatform' as const] : []),
    ...(rent !== null && (!Number.isFinite(rent) || rent < 0) ? ['invalidNumber' as const] : []),
    ...(commission !== null && (!Number.isFinite(commission) || commission < 0 || commission > 100) ? ['percentInvalid' as const] : []),
  ];
  const nothingToDo = !newDrivers.length && !importableWeeks.length && !invoicesToSave.length;

  // ---- Import ----------------------------------------------------------------------------------------------------
  async function runImport() {
    setError(undefined); setResult(null);
    try {
      // 1. Drivers: create the new ones (merging names marked as the same person) and teach matched ones their platform ids.
      setBusy({ step: 'stepDrivers', done: 0, total: newDrivers.length });
      const created = new Map<string, number>();
      for (const root of newDrivers) {
        const members = detected.filter((entry) => { const target = resolve(entry.key); return target && 'newKey' in target && target.newKey === root.key; });
        created.set(root.key, await createDriverFromIdentities(members));
        setBusy((current) => current && { ...current, done: current.done + 1 });
      }
      const driverIdFor = (key: string) => { const target = resolve(key); return !target ? null : 'driverId' in target ? target.driverId : created.get(target.newKey) ?? null; };
      for (const entry of detected) {
        const target = resolve(entry.key);
        const driver = target && 'driverId' in target ? drivers.find((value) => value.id === target.driverId) : undefined;
        if (driver) await learnIdentity(driver, entry);
      }
      if (created.size && (rent !== null || commission !== null)) {
        const fresh = await getDrivers();
        for (const id of created.values()) { const driver = fresh.find((value) => value.id === id); if (driver) await updateDriver(id, { ...driver, weeklyRent: rent ?? driver.weeklyRent, commissionRate: commission ?? driver.commissionRate }); }
      }

      // 2. Earnings: one row per driver, platform and week (a re-import replaces it), then the weekly settlements.
      setBusy({ step: 'stepEarnings', done: 0, total: earningsFiles.length });
      for (const { file, parsed } of earningsFiles) {
        if (parsed.weekStart && parsed.weekStart !== week && !weekOverride[file.id]) continue;
        const rows = parsed.rows.flatMap((row) => { const driverId = driverIdFor(keyForRow(row)); return driverId ? [{ driverId, row }] : []; });
        const importId = await createImport({ platform: parsed.platform, kind: 'earnings', weekStart: week, fileName: parsed.fileName, fileHash: parsed.hash, rowsTotal: parsed.rows.length, rowsImported: rows.length, rowsDuplicate: 0, rowsIssues: 0 });
        await saveEarnings(rows, week, currency, importId);
        setBusy((current) => current && { ...current, done: current.done + 1 });
      }
      const [freshDrivers, freshStored, freshExisting] = await Promise.all([getDrivers(), getPlatformEarnings(week), getSettlementsForWeek(week)]);
      let weeks = 0;
      setBusy({ step: 'stepSettlements', done: 0, total: importableWeeks.length });
      for (const row of importableWeeks) {
        const driverId = row.driver?.id ?? created.get(row.ref.slice(4));
        const driver = freshDrivers.find((value) => value.id === driverId);
        if (!driver) continue;
        const bolt = freshStored.find((value) => value.driverId === driver.id && value.platform === 'bolt');
        const uber = freshStored.find((value) => value.driverId === driver.id && value.platform === 'uber');
        const current = freshExisting.find((value) => value.driverId === driver.id) ?? null;
        const boltEarnings = round(bolt?.earnings ?? current?.boltEarnings ?? 0); const uberEarnings = round(uber?.earnings ?? current?.uberEarnings ?? 0);
        const input: SettlementInput = {
          ...row.input, driverId: driver.id, boltEarnings, uberEarnings,
          cashCollected: bolt || uber ? round((bolt?.cash ?? 0) + (uber?.cash ?? 0)) : row.input.cashCollected,
          fleetCommission: driver.commissionRate !== null ? commissionFor(boltEarnings + uberEarnings, driver.commissionRate) : row.input.fleetCommission,
          vehicleRent: current?.vehicleRent || driver.weeklyRent || 0,
        };
        const id = current ? (await updateSettlement(current.id, input), current.id) : await createSettlement(input);
        await linkFinesToSettlement(row.fines.map((fine) => fine.id), id);
        weeks += 1; setBusy((state) => state && { ...state, done: state.done + 1 });
      }

      // 3. Ride invoices with their original PDFs; numbers already stored are skipped by the database too.
      let invoices = 0;
      for (const plan of invoicePlan) {
        const chosen = plan.states.filter((entry) => entry.state === 'ready' || (otherWeeks && entry.state === 'otherWeek')).map(({ invoice }) => ({ invoice, driverId: driverIdFor(keyForInvoice(invoice)), weekStart: invoiceWeek(invoice) }));
        const importId = await createImport({ platform: plan.parsed.platform, kind: 'invoices', weekStart: otherWeeks ? null : week, fileName: plan.parsed.fileName, fileHash: plan.parsed.hash, rowsTotal: plan.parsed.invoices.length + plan.parsed.issues.length, rowsImported: chosen.length, rowsDuplicate: plan.stored + plan.repeated, rowsIssues: plan.parsed.issues.length });
        setBusy({ step: 'stepInvoices', done: 0, total: 1 });
        await saveRideInvoices(chosen, importId, (done, total) => setBusy({ step: 'stepInvoices', done, total }));
        invoices += chosen.length;
      }

      setResult({ drivers: created.size, weeks, invoices, skipped: invoicePlan.reduce((sum, plan) => sum + plan.stored + plan.repeated + plan.parsed.issues.length, 0) });
      toast(t('importFinished'));
      setFiles([]); setChoices({}); setIncluded({}); setWeekOverride({});
      await Promise.all([load(), loadWeek()]);
    } catch (caught) { setError(caught); }
    finally { setBusy(null); }
  }

  // ---- Rendering ---------------------------------------------------------------------------------------------------
  const fmt = (value: number) => money(value, currency, language);
  const signed = (value: number) => (value < 0 ? `-${fmt(-value)}` : fmt(value));
  const choiceOptions = (entry: Detected) => <>
    <option value="new">{t('createNewDriver')}</option>
    {detected.filter((other) => other.key !== entry.key && other.platform !== entry.platform && !automatic.get(other.key) && choiceFor(other) === 'new').map((other) => <option key={other.key} value={`same:${other.key}`}>{t('samePersonAs').replace('{name}', `${other.name} (${PLATFORM_LABEL[other.platform]})`)}</option>)}
    <optgroup label={t('existingDrivers')}>{drivers.map((driver) => <option key={driver.id} value={`driver:${driver.id}`}>{driver.fullName}</option>)}</optgroup>
    <option value="skip">{t('skipName')}</option>
  </>;

  return <AppShell>
    <PageHeader back={<Link href="/drivers" className="back-link"><i className="bi bi-arrow-left" />{t('drivers')}</Link>} title={t('importFromPlatforms')} subtitle={t('importPlatformsSubtitle')} />
    <DriverSubnav />
    {Boolean(error) && <ErrorAlert error={error} />}
    {loading ? <ListSkeleton rows={3} /> : <>
      {result && <div className="app-panel app-panel-body section-gap import-result" role="status">
        <span className="row-icon tone-success"><i className="bi bi-check2-circle" /></span>
        <div className="flex-grow-1">
          <strong className="d-block">{t('importFinished')}</strong>
          <span className="small text-body-secondary">{[t('resultDrivers').replace('{n}', String(result.drivers)), t('resultWeeks').replace('{n}', String(result.weeks)), t('resultInvoices').replace('{n}', String(result.invoices)), result.skipped ? t('resultSkipped').replace('{n}', String(result.skipped)) : null].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="d-flex flex-wrap gap-2"><Link href={`/drivers/payments?week=${week}`} className="btn btn-sm btn-primary">{t('openPayouts')}</Link><Link href={`/drivers/rides?week=${week}`} className="btn btn-sm btn-outline-secondary">{t('rideInvoices')}</Link></div>
      </div>}
      {result && result.drivers > 0 && <SetupBanner icon="bi-person-plus" title={t('newDriversNeedDetails').replace('{n}', String(result.drivers))} text={t('newDriversNeedDetailsText')} action={<Link href="/drivers" className="btn btn-sm btn-primary">{t('reviewDrivers')}</Link>} />}

      <div className="app-panel app-panel-body section-gap"><div className="row g-3 align-items-end">
        <div className="col-md-5"><label className="form-label required" htmlFor="import-week">{t('importWeek')}</label>
          <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary" aria-label={t('previous')} onClick={() => chooseWeek(addDays(week, -7))}><i className="bi bi-chevron-left" /></button><div className="flex-grow-1"><DateField id="import-week" max={today()} value={week} onChange={(value) => chooseWeek(mondayOf(value))} /></div><button type="button" className="btn btn-outline-secondary" aria-label={t('next')} disabled={addDays(week, 7) > today()} onClick={() => chooseWeek(addDays(week, 7))}><i className="bi bi-chevron-right" /></button></div>
          <div className="form-text">{localDate(week, language)} – {localDate(weekEnd(week), language)}</div></div>
        <div className="col-md-3"><label className="form-label" htmlFor="import-currency">{t('currency')}</label><select id="import-currency" className="form-select" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>RON</option><option>EUR</option></select></div>
        <div className="col-md-4"><p className="form-text mb-2">{t('importWeekHint')}</p></div>
      </div></div>

      <div className={`file-drop multi-drop section-gap ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
        <input ref={input} id="import-files" type="file" multiple accept=".csv,.zip,.pdf,text/csv,application/zip,application/pdf" className="visually-hidden" onChange={(event) => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }} />
        <label htmlFor="import-files" className="file-drop-empty">
          <span className="file-drop-icon"><i className={`bi ${dragging ? 'bi-download' : 'bi-cloud-arrow-up'}`} /></span>
          <span><span className="fw-semibold">{t('dropPlatformFiles')} </span><span className="file-drop-browse">{t('browse')}</span></span>
          <span className="small text-body-secondary">{t('dropPlatformFilesHint')}</span>
        </label>
      </div>

      {files.length > 0 && <section className="section-gap">
        <SectionHeader title={t('filesToImport')} />
        <div className="data-list">{files.map((file) => <FileRow key={file.id} file={file} week={week} plan={invoicePlan.find((plan) => plan.file.id === file.id)} overridden={Boolean(weekOverride[file.id])}
          onUseWeek={chooseWeek} onOverride={() => setWeekOverride((current) => ({ ...current, [file.id]: true }))} onRemove={() => removeFile(file.id)} />)}</div>
        {sameKindTwice.length > 0 && <p className="small text-danger mt-2 mb-0">{t('oneExportPerPlatform')}</p>}
        {otherWeekCount > 0 && <div className="form-check mt-3"><input id="import-other-weeks" type="checkbox" className="form-check-input" checked={otherWeeks} onChange={(event) => setOtherWeeks(event.target.checked)} /><label className="form-check-label" htmlFor="import-other-weeks">{t('alsoOtherWeeks').replace('{n}', String(otherWeekCount))}</label><div className="form-text mt-0">{t('alsoOtherWeeksHint')}</div></div>}
      </section>}

      {detected.length > 0 && <section className="section-gap">
        <SectionHeader title={t('driversInFiles')} action={<span className="small text-body-secondary">{t('driversFoundSummary').replace('{found}', String(detected.length)).replace('{matched}', String(detected.length - unmatched.length)).replace('{new}', String(newDrivers.length))}</span>} />
        <div className="data-list">{detected.map((entry) => {
          const auto = automatic.get(entry.key); const choice = choiceFor(entry); const suggested = !auto && !choices[entry.key] && choice !== 'new';
          return <div className="data-row import-driver-row" key={entry.key}>
            <span className={`row-icon ${auto ? 'tone-success' : choice === 'skip' ? '' : 'tone-brand'}`}><i className={`bi ${auto ? 'bi-person-check' : choice === 'new' ? 'bi-person-plus' : choice === 'skip' ? 'bi-person-dash' : 'bi-people'}`} /></span>
            <span className="data-row-main">
              <span className="data-row-title">{entry.name} <StatusPill tone="neutral">{PLATFORM_LABEL[entry.platform]}</StatusPill></span>
              <span className="data-row-subtitle">{[entry.earnings ? t('inEarnings') : null, entry.invoices ? t('invoiceCount').replace('{n}', String(entry.invoices)) : null, entry.phone, entry.email].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="import-driver-choice">
              {auto && !choices[entry.key] ? <span className="small text-success"><i className="bi bi-check2 me-1" />{t(MATCH_LABEL[auto.by])}</span> : suggested ? <span className="small text-warning"><i className="bi bi-stars me-1" />{t('suggestedMatch')}</span> : null}
              <select className="form-select form-select-sm" aria-label={`${t('driver')}: ${entry.name}`} value={choice} onChange={(event) => setChoices((current) => ({ ...current, [entry.key]: event.target.value as Choice }))}>{choiceOptions(entry)}</select>
            </span>
          </div>;
        })}</div>
        {newDrivers.length > 0 && <div className="app-panel app-panel-body mt-3"><div className="row g-3 align-items-end">
          <div className="col-12"><strong className="d-block">{t('termsForNewDrivers').replace('{n}', String(newDrivers.length))}</strong><span className="form-text">{t('termsForNewDriversHint')}</span></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="import-rent">{t('weeklyRent')}</label><input id="import-rent" type="number" min="0" step="0.01" inputMode="decimal" className="form-control" value={defaultRent} onChange={(event) => setDefaultRent(event.target.value)} /></div>
          <div className="col-sm-6"><label className="form-label" htmlFor="import-commission">{t('commissionRate')}</label><div className="input-group"><input id="import-commission" type="number" min="0" max="100" step="0.1" inputMode="decimal" className="form-control" value={defaultCommission} onChange={(event) => setDefaultCommission(event.target.value)} /><span className="input-group-text">%</span></div></div>
        </div></div>}
      </section>}

      {(settlementRows.length > 0 || invoiceOnlyRefs.length > 0) && <section className="section-gap">
        <SectionHeader title={t('weekPreview').replace('{date}', localDate(week, language))} />
        <div className="app-panel import-table-wrap"><table className="import-table">
          <thead><tr><th scope="col"><span className="visually-hidden">{t('include')}</span></th><th scope="col">{t('driver')}</th><th scope="col" className="num">Bolt</th><th scope="col" className="num">Uber</th><th scope="col" className="num">{t('cashCollected')}</th><th scope="col" className="num">{t('rideInvoicesShort')}</th><th scope="col" className="num">{t('fleetCommission')}</th><th scope="col" className="num">{t('vehicleRent')}</th><th scope="col" className="num">{t('fines')}</th><th scope="col" className="num">{t('payoutToDriver')}</th><th scope="col"></th></tr></thead>
          <tbody>
            {settlementRows.map((row) => {
              const net = row.input.boltEarnings + row.input.uberEarnings + row.input.bonuses + row.input.manualAdjustment - row.input.fleetCommission - row.input.vehicleRent - row.input.expenses - row.input.fines - row.input.cashCollected;
              const checked = isIncluded(row); const rec = reconciliation.get(row.ref);
              return <tr key={row.ref} className={checked ? '' : 'is-excluded'}>
                <td><input type="checkbox" className="form-check-input" aria-label={`${t('include')} ${row.name}`} disabled={Boolean(row.blocked)} checked={checked} onChange={(event) => setIncluded((current) => ({ ...current, [row.ref]: event.target.checked }))} /></td>
                <th scope="row">{row.name}{!row.driver && <span className="ms-2"><StatusPill tone="brand">{t('newDriver')}</StatusPill></span>}{row.input.vehicleLabel && <span className="d-block small text-body-secondary fw-normal">{row.input.vehicleLabel}</span>}</th>
                <td className="num">{signed(row.input.boltEarnings)}</td>
                <td className="num">{signed(row.input.uberEarnings)}</td>
                <td className="num">{row.input.cashCollected ? `-${fmt(row.input.cashCollected)}` : '-'}<CashCheck rec={rec} rows={row.rows} format={fmt} /></td>
                <td className="num">{rec ? <InvoiceCell rec={rec} format={fmt} /> : '-'}</td>
                <td className="num">{fmt(row.input.fleetCommission)}</td>
                <td className="num">{fmt(row.input.vehicleRent)}</td>
                <td className="num">{row.input.fines ? fmt(row.input.fines) : '-'}{row.fines.length > 0 && <span className="d-block small text-body-secondary">+{row.fines.length} {t('open').toLowerCase()}</span>}</td>
                <td className={`num fw-semibold ${net < 0 ? 'text-danger' : ''}`}>{signed(round(net))}</td>
                <td>{row.blocked ? <StatusPill tone="danger">{t('currencyMismatch')}</StatusPill> : row.current && row.current.amountSettled > 0 ? <StatusPill tone="warning">{t('alreadySettled')}</StatusPill> : row.current ? <StatusPill tone="info">{t('updatesWeek')}</StatusPill> : <StatusPill tone="success">{t('newWeek')}</StatusPill>}{row.current && row.current.amountSettled > 0 && <span className="d-block small text-body-secondary mt-1">{t('settledAmount').replace('{amount}', money(row.current.amountSettled, row.current.currency, language))}</span>}</td>
              </tr>;
            })}
            {invoiceOnlyRefs.map((ref) => {
              const name = ref.startsWith('driver:') ? drivers.find((driver) => `driver:${driver.id}` === ref)?.fullName : detected.find((entry) => `new:${entry.key}` === ref)?.name;
              return <tr key={ref} className="is-excluded"><td /><th scope="row">{name}</th><td className="num" colSpan={3}><span className="small text-warning">{t('invoicesWithoutEarnings')}</span></td><td className="num"><InvoiceCell rec={reconciliation.get(ref)!} format={fmt} /></td><td colSpan={5} /></tr>;
            })}
          </tbody>
        </table></div>
        <p className="small text-body-secondary mt-3 mb-0">{t('reconcileHint')}</p>
      </section>}

      {files.length > 0 && <div className="import-actions section-gap">
        <div className="small text-body-secondary">{nothingToDo ? t('nothingToImport') : [newDrivers.length ? t('planDrivers').replace('{n}', String(newDrivers.length)) : null, importableWeeks.length ? t('planWeeks').replace('{n}', String(importableWeeks.length)) : null, invoicesToSave.length ? t('planInvoices').replace('{n}', String(invoicesToSave.length)) : null].filter(Boolean).join(' · ')}
          {blockers.map((key) => <span key={key} className="d-block text-danger">{t(key)}</span>)}</div>
        <div className="d-flex gap-2 align-items-center">
          {busy && <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={busy.total} aria-valuenow={busy.done} aria-label={t(busy.step)}><span className="small text-body-secondary">{t(busy.step)}{busy.total > 1 ? ` ${busy.done}/${busy.total}` : ''}</span><span className="import-progress-bar"><span style={{ width: `${busy.total ? (busy.done / busy.total) * 100 : 0}%` }} /></span></div>}
          <button type="button" className="btn btn-outline-secondary" disabled={Boolean(busy)} onClick={() => setFiles([])}>{t('clearFiles')}</button>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy) || blockers.length > 0 || nothingToDo} onClick={() => void runImport()}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('runImport')}</button>
        </div>
      </div>}
    </>}
  </AppShell>;
}

function FileRow({ file, week, plan, overridden, onUseWeek, onOverride, onRemove }: {
  file: LoadedFile; week: string; overridden: boolean; onUseWeek: (week: string) => void; onOverride: () => void; onRemove: () => void;
  plan?: { ready: number; otherWeek: number; stored: number; repeated: number; parsed: { invoices: RideInvoice[]; issues: { source: string; reason: InvoiceIssueReason; number?: string }[] } };
}) {
  const { t, language } = useSettings();
  const [showIssues, setShowIssues] = useState(false);
  const parsed = file.parsed;
  const kindLabel = !parsed ? t('readingFile') : parsed.kind === 'earnings' ? `${PLATFORM_LABEL[parsed.platform]} · ${t('weeklyEarningsFile')}` : parsed.kind === 'invoices' ? `${PLATFORM_LABEL[parsed.platform]} · ${t('rideInvoicesFile')}` : t('unknownFile');
  const icon = !parsed ? 'bi-hourglass-split' : parsed.kind === 'earnings' ? 'bi-filetype-csv' : parsed.kind === 'invoices' ? 'bi-receipt' : 'bi-question-circle';
  const tone = file.error || parsed?.kind === 'unknown' ? 'tone-danger' : parsed ? 'tone-brand' : '';
  const issues = parsed?.kind === 'invoices' ? parsed.issues : [];
  return <div className="import-file">
    <div className="data-row">
      <span className={`row-icon ${tone}`}><i className={`bi ${icon}`} /></span>
      <span className="data-row-main">
        <span className="data-row-title truncate">{file.name}</span>
        <span className="data-row-subtitle">{kindLabel}{file.progress ? ` · ${t('readingProgress').replace('{done}', String(file.progress.done)).replace('{total}', String(file.progress.total))}` : ''}{parsed?.kind === 'earnings' ? ` · ${t('driverRows').replace('{n}', String(parsed.rows.length))}${parsed.weekStart ? ` · ${t('weekOf').replace('{date}', localDate(parsed.weekStart, language))}` : ''}` : ''}</span>
      </span>
      {file.previous.length > 0 && <StatusPill tone="info">{t('importedBefore').replace('{date}', localDate(file.previous[0].createdAt.slice(0, 10), language))}</StatusPill>}
      <button type="button" className="icon-button" onClick={onRemove} aria-label={t('remove')}><i className="bi bi-x-lg" /></button>
    </div>
    {file.progress && <div className="import-file-body"><span className="import-progress-bar"><span style={{ width: `${(file.progress.done / Math.max(file.progress.total, 1)) * 100}%` }} /></span></div>}
    {Boolean(file.error) && <div className="import-file-body small text-danger">{errorMessage(file.error, t)}</div>}
    {parsed?.kind === 'unknown' && <div className="import-file-body small text-danger">{t(parsed.reason === 'empty' ? 'csvEmpty' : parsed.reason === 'unsupported' ? 'fileTypeError' : 'fileNotRecognised')}</div>}
    {parsed?.kind === 'earnings' && parsed.ignored.length > 0 && <div className="import-file-body small text-body-secondary">{t('rowsIgnored').replace('{names}', parsed.ignored.map((row) => row.name).join(', '))}</div>}
    {parsed?.kind === 'earnings' && parsed.weekStart && parsed.weekStart !== week && <div className="import-file-body"><div className={`import-warning ${overridden ? 'is-muted' : ''}`}>
      <i className="bi bi-calendar-x" /><span className="flex-grow-1 small">{t('fileWeekDiffers').replace('{file}', localDate(parsed.weekStart, language)).replace('{week}', localDate(week, language))}</span>
      {!overridden && <><button type="button" className="btn btn-sm btn-primary" onClick={() => onUseWeek(parsed.weekStart!)}>{t('useFileWeek')}</button><button type="button" className="btn btn-sm btn-outline-secondary" onClick={onOverride}>{t('keepSelectedWeek')}</button></>}
    </div></div>}
    {plan && <div className="import-file-body">
      <div className="invoice-summary">
        <span><strong>{plan.parsed.invoices.length + plan.parsed.issues.length}</strong> {t('invoicesDetected')}</span>
        <span className="tone-success"><i className="bi bi-check2-circle" /><strong>{plan.parsed.invoices.length}</strong> {t('invoicesGood')}</span>
        <span className={issues.length ? 'tone-danger' : 'is-quiet'}><i className="bi bi-exclamation-triangle" /><strong>{issues.length}</strong> {t('invoicesWithIssues')}</span>
        <span className="is-divider" aria-hidden="true" />
        <span><strong>{plan.ready}</strong> {t('invoicesThisWeek')}</span>
        {plan.otherWeek > 0 && <span className="is-quiet"><strong>{plan.otherWeek}</strong> {t('invoicesOtherWeeks')}</span>}
        {plan.stored + plan.repeated > 0 && <span className="is-quiet"><strong>{plan.stored + plan.repeated}</strong> {t('invoicesAlreadyStored')}</span>}
      </div>
      {issues.length > 0 && <>
        <button type="button" className="btn btn-link btn-sm p-0 mt-2" aria-expanded={showIssues} onClick={() => setShowIssues((value) => !value)}>{showIssues ? t('hideIssues') : t('showIssues').replace('{n}', String(issues.length))}</button>
        {showIssues && <ul className="issue-list">{issues.map((issue, index) => <li key={`${issue.source}-${index}`}><span className="issue-source">{issue.source}</span>{issue.number && <span className="text-body-secondary"> · {issue.number}</span>}<span className="issue-reason">{t(ISSUE_LABEL[issue.reason])}</span></li>)}</ul>}
        <p className="small text-body-secondary mt-2 mb-0">{t('issuesNotImported')}</p>
      </>}
    </div>}
  </div>;
}

/** Number of ride invoices and their total for the week, per platform. */
function InvoiceCell({ rec, format }: { rec: Partial<Record<Platform, ReturnType<typeof invoiceTotals>>>; format: (value: number) => string }) {
  const { t } = useSettings();
  return <>{(['bolt', 'uber'] as Platform[]).filter((platform) => rec[platform]).map((platform) => <span key={platform} className="d-block">{format(rec[platform]!.total)} <span className="small text-body-secondary">· {t('ridesCount').replace('{n}', String(rec[platform]!.count))} {PLATFORM_LABEL[platform]}</span></span>)}</>;
}

/** Cash on Bolt's ride invoices should match the cash Bolt reports the driver collected; flag a gap over 2% (min 5). */
function CashCheck({ rec, rows, format }: { rec?: Partial<Record<Platform, ReturnType<typeof invoiceTotals>>>; rows: Partial<Record<Platform, EarningsRow>>; format: (value: number) => string }) {
  const { t } = useSettings();
  const bolt = rec?.bolt; const reported = rows.bolt?.cash;
  if (!bolt?.knownMethod || reported === undefined) return null;
  const gap = round(bolt.cash - reported);
  if (Math.abs(gap) <= Math.max(5, reported * 0.02)) return <span className="d-block small text-success" title={t('cashMatchesInvoices')}><i className="bi bi-check2" /> {t('cashChecked')}</span>;
  return <span className="d-block small text-warning" title={t('cashGapHint')}><i className="bi bi-exclamation-triangle" /> {t('cashGap').replace('{amount}', format(Math.abs(gap)))}</span>;
}
