'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { invoiceErrorMessage } from '@/components/invoice-forms';
import { useAuth, useSettings } from '@/components/providers';
import { ConfirmButton, Empty, ErrorAlert, ListSkeleton, StatusPill, useToast } from '@/components/ui';
import { localDate, money, today } from '@/lib/format';
import { deleteLastInvoice, downloadBlob, efacturaXml, getInvoice, invoiceCode, stornoInvoice, type Invoice, type Party } from '@/lib/invoicing';
import { countyName } from '@/lib/romania';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const router = useRouter();
  const { t, language } = useSettings();
  const { user } = useAuth();
  const { toast } = useToast();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [original, setOriginal] = useState<Invoice | null>(null);
  const [reversal, setReversal] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !Number.isInteger(invoiceId)) return;
    setError(undefined);
    try {
      const next = await getInvoice(invoiceId);
      setInvoice(next);
      setOriginal(next?.stornoOf ? await getInvoice(next.stornoOf) : null);
      if (next?.status === 'cancelled') {
        const { supabase } = await import('@/lib/supabase');
        const { data } = await supabase.from('invoices').select('id').eq('storno_of', next.id).maybeSingle<{ id: number }>();
        setReversal(data ? await getInvoice(data.id) : null);
      } else setReversal(null);
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  }, [user, invoiceId]);
  useEffect(() => { void load(); }, [load]);

  async function downloadPdf() {
    if (!invoice) return;
    setDownloading(true);
    try {
      const { renderInvoicePdf, invoiceFileStem } = await import('@/lib/invoice-pdf');
      downloadBlob(new Blob([await renderInvoicePdf(invoice, original) as BlobPart], { type: 'application/pdf' }), `${invoiceFileStem(invoice)}.pdf`);
    } catch (caught) { setError(caught); }
    finally { setDownloading(false); }
  }
  async function downloadXml() {
    if (!invoice) return;
    const { invoiceFileStem } = await import('@/lib/invoice-pdf');
    downloadBlob(new Blob([efacturaXml(invoice, original)], { type: 'application/xml' }), `${invoiceFileStem(invoice)}.xml`);
  }

  const fmt = (value: number) => (invoice ? money(value, invoice.currency, language) : '');
  return <AppShell>
    {Boolean(error) && <ErrorAlert error={error} onRetry={() => void load()} />}
    {loading ? <ListSkeleton rows={5} /> : !invoice ? <div className="app-panel"><Empty icon="bi-receipt" title={t('noInvoices')} action={<Link href="/drivers/invoices" className="btn btn-primary">{t('invoices')}</Link>} /></div> : <>
      <div className="statement-toolbar no-print">
        <Link href="/drivers/invoices" className="back-link"><i className="bi bi-arrow-left" />{t('invoices')}</Link>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm btn-primary" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-file-earmark-pdf me-2" />}{t('downloadPdf')}</button>
          {invoice.currency === 'RON' && <button className="btn btn-sm btn-outline-secondary" onClick={() => void downloadXml()}><i className="bi bi-filetype-xml me-2" />{t('downloadEfactura')}</button>}
          {invoice.status === 'issued' && !invoice.stornoOf && <ConfirmButton title={t('reverseInvoice')} message={t('reverseInvoiceConfirm')} confirmLabel={t('reverseInvoice')} cancelLabel={t('cancel')} className="btn btn-sm btn-outline-secondary" onConfirm={async () => {
            try { const id = await stornoInvoice(invoice, today()); toast(t('invoiceReversed')); router.push(`/drivers/invoices/${id}`); }
            catch (caught) { throw new Error(invoiceErrorMessage(caught, t)); }
          }}><i className="bi bi-arrow-counterclockwise me-2" />{t('reverseInvoice')}</ConfirmButton>}
          <ConfirmButton title={t('deleteInvoice')} message={t('deleteInvoiceConfirm')} confirmLabel={t('delete')} cancelLabel={t('cancel')} className="btn btn-sm btn-outline-danger" onConfirm={async () => {
            try { await deleteLastInvoice(invoice.id); toast(t('deletedItem')); router.push('/drivers/invoices'); }
            catch (caught) { throw new Error(invoiceErrorMessage(caught, t)); }
          }}><i className="bi bi-trash" /><span className="visually-hidden">{t('deleteInvoice')}</span></ConfirmButton>
        </div>
      </div>

      {invoice.status === 'cancelled' && <div className="import-warning mb-3"><i className="bi bi-arrow-counterclockwise" /><span className="small flex-grow-1">{t('invoiceWasReversed')}{reversal && <> <Link href={`/drivers/invoices/${reversal.id}`}>{invoiceCode(reversal)}</Link></>}</span></div>}
      {original && <div className="import-warning mb-3"><i className="bi bi-info-circle" /><span className="small flex-grow-1">{t('reversesInvoice')} <Link href={`/drivers/invoices/${original.id}`}>{invoiceCode(original)}</Link> · {localDate(original.issueDate, language)}</span></div>}

      <article className="app-panel statement invoice-view">
        <header className="statement-header">
          <div>
            <span className="metric-label">{invoice.stornoOf ? t('creditInvoice') : t('invoice')}</span>
            <h1 className="statement-title">{invoiceCode(invoice)}</h1>
            <p className="text-body-secondary mb-0">{t('issueDate')} {localDate(invoice.issueDate, language)} · {t('dueDate')} {localDate(invoice.dueDate, language)}</p>
          </div>
          <div className="text-sm-end">{invoice.status === 'cancelled' ? <StatusPill tone="neutral">{t('reversed')}</StatusPill> : invoice.stornoOf ? <StatusPill tone="danger">Storno</StatusPill> : <StatusPill tone="success">{t('issued')}</StatusPill>}</div>
        </header>
        <div className="invoice-parties">
          <PartyCard title={t('supplier')} party={invoice.seller} />
          <PartyCard title={t('customer')} party={invoice.buyer} />
        </div>
        <div className="import-table-wrap"><table className="statement-table invoice-lines-table">
          <thead><tr><th scope="col">{t('description')}</th><th scope="col" className="num">{t('quantity')}</th><th scope="col" className="num">{t('unitPrice')}</th><th scope="col" className="num">{t('netAmount')}</th><th scope="col" className="num">{t('vat')}</th></tr></thead>
          <tbody>{invoice.lines.map((line) => <tr key={line.position}><th scope="row">{line.description}</th><td className="num">{line.quantity}</td><td className="num">{money(line.unitPrice, invoice.currency, language)}</td><td className="num">{fmt(line.net)}</td><td className="num">{line.vatCategory === 'S' ? `${fmt(line.vat)} (${line.vatRate}%)` : line.vatCategory === 'E' ? t('vatExempt') : '-'}</td></tr>)}</tbody>
          <tfoot>
            <tr><th scope="row" colSpan={3}>{t('totalNet')}</th><td className="num" colSpan={2}>{fmt(invoice.totalNet)}</td></tr>
            <tr><th scope="row" colSpan={3}>{t('vat')}</th><td className="num" colSpan={2}>{fmt(invoice.totalVat)}</td></tr>
            <tr className="statement-total"><th scope="row" colSpan={3}>{t('totalDue')}</th><td className="num" colSpan={2}>{fmt(invoice.total)}</td></tr>
          </tfoot>
        </table></div>
        {(invoice.notes || invoice.seller.note) && <p className="small text-body-secondary mb-0 mt-3">{[invoice.notes, invoice.seller.note].filter(Boolean).join(' · ')}</p>}
        {invoice.driverId && <p className="small mb-0 mt-3 no-print"><Link href={`/drivers/${invoice.driverId}`}>{t('openDriver')}</Link>{invoice.weekStart && <> · <Link href={`/drivers/payments?week=${invoice.weekStart}`}>{t('weekOf').replace('{date}', localDate(invoice.weekStart, language))}</Link></>}</p>}
      </article>
      <p className="small text-body-secondary mt-3 no-print">{t('efacturaHint')}</p>
    </>}
  </AppShell>;
}

function PartyCard({ title, party }: { title: string; party: Party }) {
  return <div className="invoice-party">
    <span className="metric-label">{title}</span>
    <strong className="d-block mt-1">{party.name}</strong>
    <span className="small text-body-secondary d-block">{[party.taxId && `CUI/CNP ${party.taxId}`, party.regNo].filter(Boolean).join(' · ')}</span>
    <span className="small text-body-secondary d-block">{[party.address, party.city?.replace(/^SECTOR(\d)$/, 'Sector $1'), countyName(party.county)].filter(Boolean).join(', ') || '-'}</span>
    {party.iban && <span className="small text-body-secondary d-block">IBAN {party.iban}{party.bank ? ` · ${party.bank}` : ''}</span>}
  </div>;
}
