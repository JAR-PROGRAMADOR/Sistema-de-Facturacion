import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useCancelInvoice, useInvoice, useInvoices } from './api';
import { useState } from 'react';

export function InvoicesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [cancelingId, setCancelingId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const invoicesQuery = useInvoices(companyId, isPlatform);
  const invoiceQuery = useInvoice(companyId, isPlatform, selectedInvoiceId);
  const cancelInvoice = useCancelInvoice(companyId, isPlatform);

  if (companyLoading || invoicesQuery.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Facturas</h1><p className="muted">Selecciona una empresa para consultar sus facturas.</p></section>;
  if (invoicesQuery.isError) {
    return <section className="card"><p className="field__error">{invoicesQuery.error instanceof ApiError ? invoicesQuery.error.message : 'Error al cargar facturas.'}</p></section>;
  }

  const invoices = invoicesQuery.data?.items ?? [];
  const cancel = async (invoiceId: string) => {
    try {
      await cancelInvoice.mutateAsync({ invoiceId, reason: reason.trim() });
      setCancelingId('');
      setReason('');
      push('success', 'Factura anulada.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible anular la factura.');
    }
  };
  const printInvoice = () => window.print();

  return (
    <div className="stack invoices-page">
      {selectedInvoiceId && invoiceQuery.data && (
        <section className="invoice-print-area">
          <header className="invoice-document__toolbar no-print">
            <Button variant="ghost" onClick={() => setSelectedInvoiceId(null)}>Volver a facturas</Button>
            <Button onClick={printInvoice}>Imprimir factura</Button>
          </header>
          <article className="invoice-document">
            <header className="invoice-document__header">
              <div className="invoice-document__issuer">
                <span className="invoice-document__brand-mark" aria-hidden="true">F</span>
                <div>
                <span className="invoice-document__eyebrow">DOCUMENTO DE VENTA</span>
                <h1>{invoiceQuery.data.company_legal_name || invoiceQuery.data.company_name}</h1>
                {invoiceQuery.data.company_legal_name && <p>{invoiceQuery.data.company_name}</p>}
                {invoiceQuery.data.company_tax_id && <p>Identificación fiscal: {invoiceQuery.data.company_tax_id}</p>}
                {invoiceQuery.data.company_country && <p>País: {invoiceQuery.data.company_country}</p>}
                </div>
              </div>
              <div className="invoice-document__number">
                <span className="invoice-document__type">FACTURA</span>
                <strong>{invoiceQuery.data.full_number}</strong>
                <span className={`invoice-document__status${invoiceQuery.data.status === 'ANULADA' ? ' invoice-document__status--cancelled' : ''}`}>
                  <i /> {invoiceQuery.data.status === 'ANULADA' ? 'Anulada' : 'Emitida'}
                </span>
              </div>
            </header>
            <section className="invoice-document__meta">
              <div><span>FECHA DE EMISIÓN</span><strong>{new Date(invoiceQuery.data.issued_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
              <div><span>MONEDA</span><strong>{invoiceQuery.data.currency}</strong></div>
              <div><span>REFERENCIA</span><strong>{invoiceQuery.data.sale_id.slice(0, 8).toUpperCase()}</strong></div>
            </section>
            <section className="invoice-document__parties">
              <div className="invoice-document__party">
                <span className="invoice-document__section-label">EMISOR</span>
                <strong>{invoiceQuery.data.company_legal_name || invoiceQuery.data.company_name}</strong>
                {invoiceQuery.data.company_legal_name && <span>{invoiceQuery.data.company_name}</span>}
                {invoiceQuery.data.company_tax_id && <span>ID fiscal · {invoiceQuery.data.company_tax_id}</span>}
                {invoiceQuery.data.company_country && <span>{invoiceQuery.data.company_country}</span>}
              </div>
              <div className="invoice-document__party">
                <span className="invoice-document__section-label">FACTURAR A</span>
                <strong>{invoiceQuery.data.customer_name || 'Consumidor final'}</strong>
                {invoiceQuery.data.customer_tax_id && <span>ID fiscal · {invoiceQuery.data.customer_tax_id}</span>}
                {invoiceQuery.data.customer_address && <span>{invoiceQuery.data.customer_address}</span>}
              </div>
            </section>
            <div className="invoice-document__items-heading">
              <div><span className="invoice-document__section-label">DETALLE</span><h2>Conceptos facturados</h2></div>
              <span>{invoiceQuery.data.items.length} concepto(s)</span>
            </div>
            <div className="table-wrap">
              <table className="table invoice-document__items">
                <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio unitario</th><th>Impuesto</th><th>Importe</th></tr></thead>
                <tbody>{invoiceQuery.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}{item.discount > 0 && <small className="invoice-document__discount">Descuento: {item.discount.toFixed(2)}</small>}</td>
                    <td>{item.quantity}</td>
                    <td>{item.unit_price.toFixed(2)}</td>
                    <td>{item.tax_rate}% · {item.tax_amount.toFixed(2)}</td>
                    <td>{item.line_total.toFixed(2)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <section className="invoice-document__totals">
              <div><span>Subtotal</span><strong>{invoiceQuery.data.currency} {invoiceQuery.data.subtotal.toFixed(2)}</strong></div>
              {invoiceQuery.data.discount_total > 0 && <div><span>Descuentos</span><strong>− {invoiceQuery.data.currency} {invoiceQuery.data.discount_total.toFixed(2)}</strong></div>}
              <div><span>Impuestos</span><strong>{invoiceQuery.data.currency} {invoiceQuery.data.tax_total.toFixed(2)}</strong></div>
              <div className="invoice-document__grand-total"><span>Total a pagar</span><strong>{invoiceQuery.data.currency} {invoiceQuery.data.total.toFixed(2)}</strong></div>
            </section>
            <footer className="invoice-document__footer">
              <span>{invoiceQuery.data.status === 'ANULADA' ? 'ESTE DOCUMENTO FUE ANULADO' : 'Gracias por confiar en nosotros.'}</span>
              <small>Documento generado electrónicamente · {invoiceQuery.data.full_number}</small>
            </footer>
          </article>
        </section>
      )}
      {selectedInvoiceId && invoiceQuery.isLoading && <section className="card"><Spinner /></section>}
      {selectedInvoiceId && invoiceQuery.isError && <section className="card"><p className="field__error">{invoiceQuery.error instanceof ApiError ? invoiceQuery.error.message : 'No fue posible cargar el documento.'}</p><Button variant="ghost" onClick={() => setSelectedInvoiceId(null)}>Volver</Button></section>}
      <section className="card invoices-list">
        <header className="page-header"><div><h1>Facturas</h1><p className="muted">{invoicesQuery.data?.total ?? 0} factura(s) emitida(s)</p></div></header>
        {invoices.length === 0 ? <p className="muted">Aún no hay facturas emitidas.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Total</th><th>Moneda</th><th>Acciones</th></tr></thead>
            <tbody>{invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td><strong>{invoice.full_number}</strong></td>
                <td>{invoice.customer_name || 'Consumidor final'}</td>
                <td>{new Date(invoice.issued_at).toLocaleString()}</td>
                <td><span className={`status ${invoice.status === 'EMITIDA' ? 'status--ok' : 'status--off'}`}>{invoice.status}</span></td>
                <td>{invoice.total.toFixed(2)}</td>
                <td>{invoice.currency}</td>
                <td><div className="row-actions">
                  <Button variant="ghost" onClick={() => setSelectedInvoiceId(invoice.id)}>Ver / imprimir</Button>
                  {invoice.status === 'ANULADA' ? '—' : cancelingId === invoice.id ? (
                    <div className="stack"><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo de anulación" /><Button variant="danger" onClick={() => void cancel(invoice.id)} disabled={cancelInvoice.isPending || reason.trim().length < 3}>Confirmar</Button><Button variant="ghost" onClick={() => setCancelingId('')}>Cancelar</Button></div>
                  ) : <Button variant="danger" onClick={() => { setCancelingId(invoice.id); setReason(''); }}>Anular</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
