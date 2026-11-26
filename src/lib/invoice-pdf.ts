// Invoice PDFs drawn with pdf-lib, so many can be generated at once (for a ZIP) without opening print dialogs.
// Labels are Romanian (the invoice's legal language) with English underneath.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { efacturaXml, invoiceCode, invoiceRegisterCsv, type Invoice, type Party } from './invoicing';
import { countyName } from './romania';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.09, 0.11, 0.18);
const MUTED = rgb(0.42, 0.45, 0.53);
const HAIRLINE = rgb(0.88, 0.89, 0.92);
const BRAND = rgb(0.24, 0.33, 0.93);
const SOFT = rgb(0.95, 0.96, 0.99);

type Fonts = { regular: PDFFont; bold: PDFFont };
let fontBytes: Promise<[ArrayBuffer, ArrayBuffer]> | null = null;
/** Geist, the app's typeface; it covers Romanian diacritics (ș, ț, ă, î, â). */
function loadFontBytes(base = '') {
  fontBytes ??= Promise.all(['Geist-Regular.ttf', 'Geist-SemiBold.ttf'].map(async (name) => {
    const response = await fetch(`${base}/fonts/${name}`);
    if (!response.ok) throw new Error(`Font ${name} could not be loaded.`);
    return response.arrayBuffer();
  })) as Promise<[ArrayBuffer, ArrayBuffer]>;
  return fontBytes;
}

const formatAmount = (value: number) => new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const formatQuantity = (value: number) => new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 3 }).format(value);
const formatDate = (value: string) => { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; };

/** Splits text into lines that fit `width`, breaking long words if they must. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut)); rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page: PDFPage; y: number;
  constructor(private doc: PDFDocument, private fonts: Fonts, private onNewPage: (writer: Writer) => void) { this.page = doc.addPage([A4.width, A4.height]); this.y = A4.height - MARGIN; }
  text(value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right'; width?: number } = {}) {
    const size = options.size ?? 9; const font = options.bold ? this.fonts.bold : this.fonts.regular;
    const left = options.align === 'right' ? x + (options.width ?? 0) - font.widthOfTextAtSize(value, size) : x;
    this.page.drawText(value, { x: left, y, size, font, color: options.color ?? INK });
  }
  ensure(height: number) {
    if (this.y - height >= MARGIN + 30) return;
    this.page = this.doc.addPage([A4.width, A4.height]); this.y = A4.height - MARGIN; this.onNewPage(this);
  }
}

type PartyLayout = { name: string[]; details: [label: string, lines: string[]][]; height: number };
/** Measures a party block first, so both blocks can share the height of the taller one. */
function partyLayout(fonts: Fonts, party: Party, width: number): PartyLayout {
  const name = wrap(party.name, fonts.bold, 10.5, width - 24).slice(0, 2);
  const details = ([
    ['CUI/CIF', party.taxId], ['Reg. Com.', party.regNo],
    ['Adresa', [party.address, party.county === 'RO-B' && party.city ? party.city.replace(/^SECTOR(\d)$/, 'Sector $1') : party.city, countyName(party.county)].filter(Boolean).join(', ')],
    ['IBAN', party.iban], ['Banca', party.bank], ['Contact', [party.phone, party.email].filter(Boolean).join(' · ')],
  ] as [string, string | null | undefined][]).filter(([, value]) => value).map(([label, value]): [string, string[]] => [label, wrap(value!, fonts.regular, 8.5, width - 80).slice(0, 3)]);
  return { name, details, height: 36 + name.length * 13 + details.reduce((sum, [, lines]) => sum + lines.length * 11 + 2, 0) + 6 };
}

function partyBlock(writer: Writer, fonts: Fonts, layout: PartyLayout, height: number, title: string, subtitle: string, x: number, top: number, width: number) {
  writer.page.drawRectangle({ x, y: top - height, width, height, color: SOFT });
  writer.text(title.toUpperCase(), x + 12, top - 18, { size: 7.5, bold: true, color: BRAND });
  writer.text(subtitle, x + 12 + fonts.bold.widthOfTextAtSize(title.toUpperCase(), 7.5) + 6, top - 18, { size: 7.5, color: MUTED });
  let y = top - 36;
  for (const line of layout.name) { writer.text(line, x + 12, y, { size: 10.5, bold: true }); y -= 13; }
  for (const [label, lines] of layout.details) {
    writer.text(label, x + 12, y, { size: 7.5, color: MUTED });
    lines.forEach((line, index) => writer.text(line, x + 64, y - index * 11, { size: 8.5 }));
    y -= 11 * lines.length + 2;
  }
}

/** One invoice as a PDF. */
export async function renderInvoicePdf(invoice: Invoice, original?: Pick<Invoice, 'series' | 'number' | 'issueDate'> | null, fontBase = '') {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFontBytes(fontBase);
  const fonts: Fonts = { regular: await doc.embedFont(regularBytes, { subset: true }), bold: await doc.embedFont(boldBytes, { subset: true }) };
  const code = invoiceCode(invoice);
  const storno = invoice.stornoOf !== null;
  doc.setTitle(`${storno ? 'Factură storno' : 'Factură'} ${code}`); doc.setAuthor(invoice.seller.name); doc.setCreator('Vehix'); doc.setProducer('Vehix');
  doc.setCreationDate(new Date(`${invoice.issueDate}T12:00:00`));

  const width = A4.width - MARGIN * 2;
  const columns = [
    { key: 'no', label: 'Nr.', sub: 'No.', width: 24, align: 'left' as const },
    { key: 'description', label: 'Denumire', sub: 'Description', width: 0, align: 'left' as const },
    { key: 'unit', label: 'U.M.', sub: 'Unit', width: 34, align: 'left' as const },
    { key: 'quantity', label: 'Cant.', sub: 'Qty', width: 38, align: 'right' as const },
    { key: 'price', label: 'Preț unitar', sub: 'Unit price', width: 64, align: 'right' as const },
    { key: 'net', label: 'Valoare', sub: 'Net', width: 66, align: 'right' as const },
    { key: 'rate', label: 'TVA %', sub: 'VAT %', width: 38, align: 'right' as const },
    { key: 'vat', label: 'TVA', sub: 'VAT', width: 56, align: 'right' as const },
  ];
  columns[1].width = width - columns.reduce((sum, column) => sum + column.width, 0);
  const tableHeader = (writer: Writer) => {
    writer.page.drawRectangle({ x: MARGIN, y: writer.y - 26, width, height: 26, color: INK });
    let x = MARGIN;
    columns.forEach((column) => {
      const pad = column.align === 'right' ? -6 : 6;
      writer.text(column.label, x + (column.align === 'right' ? 0 : pad), writer.y - 11, { size: 7.5, bold: true, color: rgb(1, 1, 1), align: column.align, width: column.width + (column.align === 'right' ? pad : 0) });
      writer.text(column.sub, x + (column.align === 'right' ? 0 : pad), writer.y - 21, { size: 6.5, color: rgb(0.75, 0.78, 0.85), align: column.align, width: column.width + (column.align === 'right' ? pad : 0) });
      x += column.width;
    });
    writer.y -= 26;
  };
  const writer = new Writer(doc, fonts, (next) => { next.text(`${code} · continuare`, MARGIN, next.y, { size: 8, color: MUTED }); next.y -= 18; tableHeader(next); });

  // Title block.
  writer.page.drawRectangle({ x: 0, y: A4.height - 6, width: A4.width, height: 6, color: BRAND });
  writer.text(storno ? 'FACTURĂ STORNO' : 'FACTURĂ', MARGIN, writer.y - 18, { size: 22, bold: true });
  writer.text(storno ? 'Credit invoice' : 'Invoice', MARGIN, writer.y - 32, { size: 9, color: MUTED });
  const meta: [string, string, string][] = [['Seria și nr.', 'Number', code], ['Data emiterii', 'Issue date', formatDate(invoice.issueDate)], ['Scadența', 'Due date', formatDate(invoice.dueDate)]];
  if (original) meta.push(['Stornează', 'Reverses', `${invoiceCode(original)} / ${formatDate(original.issueDate)}`]);
  meta.forEach(([label, sub, value], index) => {
    const y = writer.y - 6 - index * 15;
    writer.text(`${label} / ${sub}`, A4.width - MARGIN - 230, y, { size: 7.5, color: MUTED });
    writer.text(value, A4.width - MARGIN - 120, y, { size: 9, bold: true, align: 'right', width: 120 });
  });
  writer.y -= 62;

  // Parties.
  const half = (width - 14) / 2;
  const seller = partyLayout(fonts, invoice.seller, half); const buyer = partyLayout(fonts, invoice.buyer, half);
  const blockHeight = Math.max(seller.height, buyer.height, 110);
  partyBlock(writer, fonts, seller, blockHeight, 'Furnizor', 'Supplier', MARGIN, writer.y, half);
  partyBlock(writer, fonts, buyer, blockHeight, 'Client', 'Customer', MARGIN + half + 14, writer.y, half);
  writer.y -= blockHeight + 18;
  if (invoice.seller.vatPayer === false) { writer.text('Furnizor neplătitor de TVA / Supplier not registered for VAT', MARGIN, writer.y, { size: 7.5, color: MUTED }); writer.y -= 14; }

  // Lines.
  tableHeader(writer);
  invoice.lines.forEach((line, index) => {
    const description = wrap(line.description, fonts.regular, 8.5, columns[1].width - 12);
    const height = Math.max(22, 10 + description.length * 11);
    writer.ensure(height);
    if (index % 2 === 1) writer.page.drawRectangle({ x: MARGIN, y: writer.y - height, width, height, color: SOFT });
    const values: Record<string, string> = {
      no: String(line.position), unit: line.unit === 'C62' ? 'buc' : line.unit === 'WEE' ? 'săpt' : line.unit, quantity: formatQuantity(line.quantity),
      price: formatAmount(line.unitPrice), net: formatAmount(line.net), rate: line.vatCategory === 'S' ? `${formatQuantity(line.vatRate)}%` : line.vatCategory === 'E' ? 'scutit' : '-', vat: line.vatCategory === 'S' ? formatAmount(line.vat) : '-',
    };
    let x = MARGIN;
    columns.forEach((column) => {
      if (column.key === 'description') description.forEach((text, row) => writer.text(text, x + 6, writer.y - 14 - row * 11, { size: 8.5 }));
      else writer.text(values[column.key], column.align === 'right' ? x : x + 6, writer.y - 14, { size: 8.5, align: column.align, width: column.width - 6 });
      x += column.width;
    });
    writer.y -= height;
    writer.page.drawLine({ start: { x: MARGIN, y: writer.y }, end: { x: MARGIN + width, y: writer.y }, thickness: 0.5, color: HAIRLINE });
  });

  // Totals.
  writer.ensure(110);
  writer.y -= 14;
  const boxWidth = 230; const boxX = A4.width - MARGIN - boxWidth;
  const totals: [string, number][] = [['Total fără TVA / Net', invoice.totalNet], ['TVA / VAT', invoice.totalVat]];
  totals.forEach(([label, value]) => {
    writer.text(label, boxX, writer.y - 10, { size: 8.5, color: MUTED });
    writer.text(`${formatAmount(value)} ${invoice.currency}`, boxX, writer.y - 10, { size: 9, align: 'right', width: boxWidth });
    writer.y -= 18;
  });
  writer.page.drawRectangle({ x: boxX - 10, y: writer.y - 34, width: boxWidth + 10, height: 32, color: BRAND });
  writer.text('Total de plată', boxX, writer.y - 15, { size: 9, bold: true, color: rgb(1, 1, 1) });
  writer.text('Amount due', boxX, writer.y - 27, { size: 7, color: rgb(0.85, 0.88, 1) });
  writer.text(`${formatAmount(invoice.total)} ${invoice.currency}`, boxX, writer.y - 23, { size: 13, bold: true, color: rgb(1, 1, 1), align: 'right', width: boxWidth - 8 });
  writer.y -= 52;

  // Notes and payment details.
  const notes = [invoice.notes, invoice.seller.note].filter(Boolean) as string[];
  if (invoice.seller.iban) notes.unshift(`Plata în contul ${invoice.seller.iban}${invoice.seller.bank ? ` (${invoice.seller.bank})` : ''}, cu mențiunea ${code}.`);
  for (const note of notes) for (const line of wrap(note, fonts.regular, 8.5, width)) { writer.ensure(14); writer.text(line, MARGIN, writer.y, { size: 8.5, color: MUTED }); writer.y -= 12; }

  // Footer on every page.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: A4.width - MARGIN, y: MARGIN }, thickness: 0.5, color: HAIRLINE });
    page.drawText(`${invoice.seller.name} · ${code}`, { x: MARGIN, y: MARGIN - 14, size: 7, font: fonts.regular, color: MUTED });
    const label = `Pagina ${index + 1} din ${pages.length}`;
    page.drawText(label, { x: A4.width - MARGIN - fonts.regular.widthOfTextAtSize(label, 7), y: MARGIN - 14, size: 7, font: fonts.regular, color: MUTED });
  });
  return doc.save();
}

const fileStem = (invoice: Invoice) => `Factura_${invoiceCode(invoice)}_${invoice.buyer.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}`;

/** Every invoice as PDF and e-Factura XML, plus the register, in one ZIP. */
export async function invoicesZip(invoices: Invoice[], language: 'en' | 'ro', onProgress?: (done: number, total: number) => void) {
  const { zipSync, strToU8 } = await import('fflate');
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const files: Record<string, Uint8Array> = {};
  let done = 0;
  for (const invoice of invoices) {
    const original = invoice.stornoOf ? byId.get(invoice.stornoOf) ?? null : null;
    const stem = fileStem(invoice);
    files[`PDF/${stem}.pdf`] = await renderInvoicePdf(invoice, original);
    if (invoice.currency === 'RON') files[`e-Factura/${stem}.xml`] = strToU8(efacturaXml(invoice, original));
    onProgress?.(++done, invoices.length);
  }
  files[language === 'ro' ? 'Registru_facturi.csv' : 'Invoice_register.csv'] = strToU8(invoiceRegisterCsv(invoices, language));
  return zipSync(files, { level: 6 });
}
export { fileStem as invoiceFileStem };
