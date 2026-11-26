// Invoices the fleet issues to its drivers (rent, commission, recharged costs), the company profile they are issued
// from, and their exports: the e-Factura XML (RO CIUS 1.0.1 over EN 16931 UBL) and the register for the accountant.
import type { Currency } from './database';
import type { Driver, Settlement } from './drivers';
import { addDays, localDate } from './format';
import { BUCHAREST_SECTORS, countyName } from './romania';
import { expectOk, supabase, unwrapList } from './supabase';

export type CompanyProfile = {
  name: string; taxId: string; vatPayer: boolean; regNo: string | null; address: string; city: string; county: string; country: string;
  iban: string | null; bank: string | null; email: string | null; phone: string | null;
  invoiceSeries: string; nextInvoiceNumber: number; defaultVatRate: number; paymentDays: number; invoiceNote: string | null;
};
/** Seller or buyer as printed on an issued invoice (a snapshot, so later edits never change it). */
export type Party = {
  name: string; taxId: string | null; vatPayer?: boolean; regNo: string | null; address: string | null; city: string | null; county: string | null; country: string;
  iban?: string | null; bank?: string | null; email?: string | null; phone?: string | null; note?: string | null;
};
export type VatCategory = 'S' | 'E' | 'O';
export type InvoiceLine = { position: number; description: string; quantity: number; unit: string; unitPrice: number; vatCategory: VatCategory; vatRate: number; net: number; vat: number };
export type Invoice = {
  id: number; series: string; number: number; issueDate: string; dueDate: string; driverId: number | null; settlementId: number | null; weekStart: string | null;
  currency: Currency; seller: Party; buyer: Party; totalNet: number; totalVat: number; total: number; status: 'issued' | 'cancelled'; stornoOf: number | null;
  notes: string | null; createdAt: string; lines: InvoiceLine[];
};
export type DraftLine = { description: string; quantity: number; unit: string; unitPrice: number; vatRate: number };

// ---------------------------------------------------------------------------------------------------------------
// Company profile

type ProfileRow = {
  name: string; tax_id: string; vat_payer: boolean; reg_no: string | null; address: string; city: string; county: string; country: string; iban: string | null; bank: string | null;
  email: string | null; phone: string | null; invoice_series: string; next_invoice_number: number; default_vat_rate: number | string; payment_days: number; invoice_note: string | null;
};
const PROFILE_COLUMNS = 'name, tax_id, vat_payer, reg_no, address, city, county, country, iban, bank, email, phone, invoice_series, next_invoice_number, default_vat_rate, payment_days, invoice_note';
export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const { data, error } = await supabase.from('company_profiles').select(PROFILE_COLUMNS).maybeSingle<ProfileRow>();
  if (error) throw new Error(`Loading company failed: ${error.message}`);
  if (!data) return null;
  return {
    name: data.name, taxId: data.tax_id, vatPayer: data.vat_payer, regNo: data.reg_no, address: data.address, city: data.city, county: data.county, country: data.country,
    iban: data.iban, bank: data.bank, email: data.email, phone: data.phone, invoiceSeries: data.invoice_series, nextInvoiceNumber: data.next_invoice_number,
    defaultVatRate: Number(data.default_vat_rate), paymentDays: data.payment_days, invoiceNote: data.invoice_note,
  };
}
export async function saveCompanyProfile(profile: CompanyProfile, exists: boolean) {
  const blank = (value: string | null) => value?.trim() || null;
  const payload = {
    name: profile.name.trim(), tax_id: profile.taxId.trim().toUpperCase(), vat_payer: profile.vatPayer, reg_no: blank(profile.regNo), address: profile.address.trim(),
    city: profile.city.trim(), county: profile.county, country: profile.country || 'RO', iban: blank(profile.iban)?.replace(/\s+/g, '').toUpperCase() ?? null, bank: blank(profile.bank),
    email: blank(profile.email), phone: blank(profile.phone), invoice_series: profile.invoiceSeries.trim().toUpperCase(), next_invoice_number: profile.nextInvoiceNumber,
    default_vat_rate: profile.defaultVatRate, payment_days: profile.paymentDays, invoice_note: blank(profile.invoiceNote),
  };
  expectOk(exists ? await supabase.from('company_profiles').update(payload).not('user_id', 'is', null) : await supabase.from('company_profiles').insert(payload), 'Saving company');
}
/** What is still missing before invoices (and their e-Factura XML) can be issued. */
export function profileGaps(profile: CompanyProfile | null) {
  if (!profile) return ['companyName'] as const;
  return ([['companyName', profile.name], ['taxId', profile.taxId], ['streetAddress', profile.address], ['city', profile.city], ['county', profile.county]] as const)
    .filter(([, value]) => !value?.trim()).map(([key]) => key);
}

// ---------------------------------------------------------------------------------------------------------------
// Invoices

type InvoiceRow = {
  id: number; series: string; number: number; issue_date: string; due_date: string; driver_id: number | null; settlement_id: number | null; week_start: string | null; currency: string;
  seller: Party; buyer: Party; total_net: number | string; total_vat: number | string; total: number | string; status: string; storno_of: number | null; notes: string | null; created_at: string;
  invoice_lines?: { position: number; description: string; quantity: number | string; unit: string; unit_price: number | string; vat_category: string; vat_rate: number | string; net: number | string; vat: number | string }[];
};
const INVOICE_COLUMNS = 'id, series, number, issue_date, due_date, driver_id, settlement_id, week_start, currency, seller, buyer, total_net, total_vat, total, status, storno_of, notes, created_at, invoice_lines(position, description, quantity, unit, unit_price, vat_category, vat_rate, net, vat)';
const mapInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id, series: row.series, number: row.number, issueDate: row.issue_date, dueDate: row.due_date, driverId: row.driver_id, settlementId: row.settlement_id, weekStart: row.week_start,
  currency: row.currency === 'EUR' ? 'EUR' : 'RON', seller: row.seller, buyer: row.buyer, totalNet: Number(row.total_net), totalVat: Number(row.total_vat), total: Number(row.total),
  status: row.status === 'cancelled' ? 'cancelled' : 'issued', stornoOf: row.storno_of, notes: row.notes, createdAt: row.created_at,
  lines: (row.invoice_lines ?? []).sort((a, b) => a.position - b.position).map((line) => ({
    position: line.position, description: line.description, quantity: Number(line.quantity), unit: line.unit, unitPrice: Number(line.unit_price),
    vatCategory: line.vat_category === 'E' ? 'E' : line.vat_category === 'O' ? 'O' : 'S', vatRate: Number(line.vat_rate), net: Number(line.net), vat: Number(line.vat),
  })),
});
export async function getInvoices(filter: { from?: string; to?: string; driverId?: number } = {}) {
  let query = supabase.from('invoices').select(INVOICE_COLUMNS).order('issue_date', { ascending: false }).order('number', { ascending: false });
  if (filter.from) query = query.gte('issue_date', filter.from);
  if (filter.to) query = query.lte('issue_date', filter.to);
  if (filter.driverId !== undefined) query = query.eq('driver_id', filter.driverId);
  return unwrapList(await query.returns<InvoiceRow[]>(), 'Loading invoices').map(mapInvoice);
}
export async function getInvoice(id: number) {
  const { data, error } = await supabase.from('invoices').select(INVOICE_COLUMNS).eq('id', id).maybeSingle<InvoiceRow>();
  if (error) throw new Error(`Loading invoice failed: ${error.message}`);
  return data ? mapInvoice(data) : null;
}
export async function issueInvoice(input: { driverId: number; settlementId: number | null; issueDate: string; dueDate: string; currency: Currency; lines: DraftLine[]; notes: string | null; stornoOf?: number | null }) {
  const { data, error } = await supabase.rpc('issue_invoice', {
    p_driver_id: input.driverId, p_settlement_id: input.settlementId, p_issue_date: input.issueDate, p_due_date: input.dueDate, p_currency: input.currency,
    p_lines: input.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, vatRate: line.vatRate })),
    p_notes: input.notes, p_storno_of: input.stornoOf ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
/** A reversal: same lines with negative quantities, referencing the original, which becomes "cancelled". */
export async function stornoInvoice(invoice: Invoice, issueDate: string) {
  if (!invoice.driverId) throw new Error('Driver not found');
  return issueInvoice({
    driverId: invoice.driverId, settlementId: null, issueDate, dueDate: issueDate, currency: invoice.currency, stornoOf: invoice.id,
    notes: `Storno ${invoiceCode(invoice)} / ${invoice.issueDate}`,
    lines: invoice.lines.map((line) => ({ description: line.description, quantity: -line.quantity, unit: line.unit, unitPrice: line.unitPrice, vatRate: line.vatRate })),
  });
}
export async function deleteLastInvoice(id: number) {
  const { error } = await supabase.rpc('delete_last_invoice', { p_invoice_id: id });
  if (error) throw new Error(error.message);
}

export const invoiceCode = (invoice: Pick<Invoice, 'series' | 'number'>) => `${invoice.series}-${String(invoice.number).padStart(4, '0')}`;

/**
 * Net amounts (2 decimals) for VAT-inclusive line amounts, chosen so that the invoice total comes out exactly at the
 * inclusive sum: VAT is computed once per rate (see draftTotals), so plain per-line division can drift by a ban.
 */
export function netsFromGross(lines: { gross: number; vatRate: number }[]) {
  const cents = (value: number) => Math.round(value * 100);
  const nets = lines.map((line) => cents(line.gross / (1 + line.vatRate / 100)));
  for (const rate of new Set(lines.map((line) => line.vatRate))) {
    const members = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.vatRate === rate);
    const gross = members.reduce((sum, { line }) => sum + cents(line.gross), 0);
    const ideal = Math.round(gross / (1 + rate / 100));
    const target = [0, -1, 1, -2, 2].map((delta) => ideal + delta).find((net) => net + Math.round((net * rate) / 100) === gross) ?? ideal;
    const largest = members.reduce((best, member) => (Math.abs(member.line.gross) > Math.abs(best.line.gross) ? member : best), members[0]);
    nets[largest.index] += target - members.reduce((sum, { index }) => sum + nets[index], 0);
  }
  return nets.map((value) => value / 100);
}

/**
 * The lines a week's settlement turns into: what the driver pays the fleet (rent, commission) and, if chosen,
 * recharged fines and expenses. Settlement amounts are what the driver pays, so they are treated as VAT-inclusive.
 */
export function linesFromSettlement(settlement: Settlement, profile: CompanyProfile, options: { fines: boolean; expenses: boolean }, language: 'en' | 'ro' = 'ro'): DraftLine[] {
  const gross = grossLinesFromSettlement(settlement, profile, options, language);
  const nets = netsFromGross(gross);
  return gross.map((line, index) => ({ description: line.description, quantity: 1, unit: 'C62', unitPrice: nets[index], vatRate: line.vatRate }));
}

/** The same lines with the VAT-inclusive amounts as deducted in the settlement. */
export function grossLinesFromSettlement(settlement: Settlement, profile: CompanyProfile, options: { fines: boolean; expenses: boolean }, language: 'en' | 'ro' = 'ro') {
  const rate = profile.vatPayer ? profile.defaultVatRate : 0;
  const period = `${localDate(settlement.weekStart, language)} – ${localDate(addDays(settlement.weekStart, 6), language)}`;
  const ro = language === 'ro';
  const gross: { description: string; gross: number; vatRate: number }[] = [];
  if (settlement.vehicleRent > 0) gross.push({ description: `${ro ? 'Chirie autoturism' : 'Vehicle rent'}${settlement.vehicleLabel ? ` ${settlement.vehicleLabel}` : ''}, ${period}`, gross: settlement.vehicleRent, vatRate: rate });
  if (settlement.fleetCommission > 0) gross.push({ description: `${ro ? 'Comision administrare flotă' : 'Fleet management commission'}, ${period}`, gross: settlement.fleetCommission, vatRate: rate });
  if (options.expenses && settlement.expenses > 0) gross.push({ description: `${ro ? 'Refacturare cheltuieli' : 'Recharged expenses'}, ${period}`, gross: settlement.expenses, vatRate: rate });
  // Fines are penalties, not a supply: recharged without VAT.
  if (options.fines && settlement.fines > 0) gross.push({ description: `${ro ? 'Refacturare amenzi' : 'Recharged fines'}, ${period}`, gross: settlement.fines, vatRate: 0 });
  return gross;
}

/** Totals as the database computes them: VAT once per rate on the summed net amounts. */
export function draftTotals(lines: DraftLine[], vatPayer: boolean) {
  const net = lines.map((line) => ({ rate: vatPayer ? line.vatRate : 0, net: Math.round(line.quantity * Math.round(line.unitPrice * 10000) / 10000 * 100) / 100 }));
  const totalNet = net.reduce((sum, line) => sum + line.net, 0);
  const rates = new Map<number, number>();
  net.forEach((line) => rates.set(line.rate, (rates.get(line.rate) ?? 0) + line.net));
  const totalVat = [...rates].reduce((sum, [rate, taxable]) => sum + Math.round(taxable * rate) / 100, 0);
  return { totalNet: round2(totalNet), totalVat: round2(totalVat), total: round2(totalNet + totalVat) };
}
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Buyer fields e-Factura needs that the driver's profile lacks. */
export function buyerGaps(driver: Pick<Driver, 'billing'>) {
  return ([['streetAddress', driver.billing.address], ['city', driver.billing.city], ['county', driver.billing.county]] as const).filter(([, value]) => !value?.trim()).map(([key]) => key);
}

// ---------------------------------------------------------------------------------------------------------------
// e-Factura XML

const xml = (value: string | number | null | undefined) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** City as e-Factura expects it: Bucharest addresses use "SECTOR1".."SECTOR6". */
function efacturaCity(party: Party) {
  if (party.county !== 'RO-B') return party.city ?? '';
  const sector = (party.city ?? '').toUpperCase().replace(/\s+/g, '').match(/SECTOR([1-6])/)?.[1];
  return sector ? `SECTOR${sector}` : BUCHAREST_SECTORS[0];
}

/** `vatIds` is false on invoices outside the VAT system (category O), which must carry no VAT identifiers at all (BR-O-02). */
function partyXml(party: Party, role: 'supplier' | 'customer', vatIds: boolean) {
  const taxId = (party.taxId ?? '').replace(/\s+/g, '').toUpperCase();
  const vatRegistered = vatIds && (role === 'supplier' ? Boolean(party.vatPayer) && /^(RO)?\d{2,10}$/.test(taxId) : /^RO\d{2,10}$/.test(taxId));
  const vatId = vatRegistered ? (taxId.startsWith('RO') ? taxId : `RO${taxId}`) : null;
  const legalId = taxId.replace(/^RO/, '') || (role === 'customer' ? '0000000000000' : '');
  return `<cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${xml(party.address)}</cbc:StreetName>
        <cbc:CityName>${xml(efacturaCity(party))}</cbc:CityName>
        <cbc:CountrySubentity>${xml(party.county)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${xml(party.country || 'RO')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>${vatId ? `
      <cac:PartyTaxScheme><cbc:CompanyID>${xml(vatId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xml(party.name)}</cbc:RegistrationName>${legalId && !vatId ? `
        <cbc:CompanyID>${xml(legalId)}</cbc:CompanyID>` : party.regNo ? `
        <cbc:CompanyID>${xml(party.regNo)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>${party.email || party.phone ? `
      <cac:Contact>${party.phone ? `<cbc:Telephone>${xml(party.phone)}</cbc:Telephone>` : ''}${party.email ? `<cbc:ElectronicMail>${xml(party.email)}</cbc:ElectronicMail>` : ''}</cac:Contact>` : ''}
    </cac:Party>`;
}

/** Exempt (E) and out-of-scope (O) subtotals must say why (BR-E-10, BR-O-10). */
function exemptionXml(category: VatCategory) {
  if (category === 'O') return '<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>';
  if (category === 'E') return '<cbc:TaxExemptionReason>Sume care nu se cuprind în baza de impozitare a TVA</cbc:TaxExemptionReason>';
  return '';
}

function taxCategoryXml(category: VatCategory, rate: number) {
  return `<cac:TaxCategory><cbc:ID>${category}</cbc:ID>${category === 'O' ? '' : `<cbc:Percent>${rate.toFixed(2)}</cbc:Percent>`}${exemptionXml(category)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`;
}

/** UBL 2.1 invoice following RO CIUS 1.0.1, ready to upload to ANAF's SPV. RON invoices only. */
export function efacturaXml(invoice: Invoice, original?: Pick<Invoice, 'series' | 'number' | 'issueDate'> | null) {
  const currency = invoice.currency;
  const groups = new Map<string, { category: VatCategory; rate: number; taxable: number }>();
  invoice.lines.forEach((line) => {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const group = groups.get(key) ?? { category: line.vatCategory, rate: line.vatRate, taxable: 0 };
    group.taxable += line.net; groups.set(key, group);
  });
  const subtotals = [...groups.values()].map((group) => ({ ...group, tax: Math.round(group.taxable * group.rate) / 100 }));
  const totalVat = subtotals.reduce((sum, group) => sum + group.tax, 0);
  const notes = [invoice.notes, invoice.seller.note].filter(Boolean).join(' · ');
  const vatIds = !invoice.lines.some((line) => line.vatCategory === 'O');
  const lines = invoice.lines.map((line) => `  <cac:InvoiceLine>
    <cbc:ID>${line.position}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xml(line.unit)}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${amount(line.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xml(line.description.slice(0, 200))}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>${line.vatCategory}</cbc:ID>${line.vatCategory === 'O' ? '' : `<cbc:Percent>${line.vatRate.toFixed(2)}</cbc:Percent>`}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${currency}">${line.unitPrice.toFixed(4).replace(/0{1,2}$/, '')}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${xml(invoiceCode(invoice))}</cbc:ID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  <cbc:DueDate>${invoice.dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${notes ? `
  <cbc:Note>${xml(notes.slice(0, 300))}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${original ? `
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xml(invoiceCode(original))}</cbc:ID><cbc:IssueDate>${original.issueDate}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AccountingSupplierParty>
    ${partyXml(invoice.seller, 'supplier', vatIds)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${partyXml(invoice.buyer, 'customer', vatIds)}
  </cac:AccountingCustomerParty>${invoice.seller.iban ? `
  <cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${xml(invoice.seller.iban)}</cbc:ID>${invoice.seller.bank ? `<cbc:Name>${xml(invoice.seller.bank)}</cbc:Name>` : ''}</cac:PayeeFinancialAccount></cac:PaymentMeans>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${amount(totalVat)}</cbc:TaxAmount>
${subtotals.map((group) => `    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${amount(group.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${amount(group.tax)}</cbc:TaxAmount>${taxCategoryXml(group.category, group.rate)}</cac:TaxSubtotal>`).join('\n')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${amount(invoice.totalNet)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${amount(invoice.totalNet)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${amount(invoice.totalNet + totalVat)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${amount(invoice.totalNet + totalVat)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Register for the accountant (CSV that Excel opens directly, with a semicolon delimiter as Romanian Excel expects).

export function invoiceRegisterCsv(invoices: Invoice[], language: 'en' | 'ro') {
  const ro = language === 'ro';
  const header = ro
    ? ['Serie', 'Număr', 'Data emiterii', 'Scadență', 'Client', 'CUI/CNP client', 'Adresă client', 'Moneda', 'Valoare fără TVA', 'TVA', 'Total', 'Stare', 'Storno pentru', 'Săptămâna']
    : ['Series', 'Number', 'Issue date', 'Due date', 'Customer', 'Customer tax id', 'Customer address', 'Currency', 'Net', 'VAT', 'Total', 'Status', 'Reverses', 'Week'];
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : typeof value === 'number' ? value.toFixed(2).replace('.', ro ? ',' : '.') : value;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const rows = [...invoices].sort((a, b) => a.series.localeCompare(b.series) || a.number - b.number).map((invoice) => [
    invoice.series, String(invoice.number), invoice.issueDate, invoice.dueDate, invoice.buyer.name, invoice.buyer.taxId ?? '',
    [invoice.buyer.address, invoice.buyer.city, countyName(invoice.buyer.county)].filter(Boolean).join(', '), invoice.currency,
    invoice.totalNet, invoice.totalVat, invoice.total,
    invoice.status === 'cancelled' ? (ro ? 'Stornată' : 'Reversed') : invoice.stornoOf ? 'Storno' : (ro ? 'Emisă' : 'Issued'),
    invoice.stornoOf ? (byId.get(invoice.stornoOf) ? invoiceCode(byId.get(invoice.stornoOf)!) : String(invoice.stornoOf)) : '', invoice.weekStart ?? '',
  ].map(cell).join(';'));
  return '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n');
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Error codes raised by the invoice functions, as translation keys. */
export const INVOICE_ERRORS = {
  company_profile_missing: 'companyProfileMissing', invoice_not_last: 'invoiceNotLast', invoice_no_lines: 'invoiceNoLines',
  invoice_line_invalid: 'invoiceLineInvalid', invoice_due_before_issue: 'expiryDateError', buyer_address_missing: 'buyerAddressMissing',
} as const;
