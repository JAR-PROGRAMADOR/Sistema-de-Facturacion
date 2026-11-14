import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { useOpenCashSession } from '../cash/api';
import { NumberInput } from '../../shared/ui/NumberInput';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useCustomers, type Customer } from '../customers/api';
import { useProducts, type Product } from '../products/api';
import { useCancelSale, useCreateSale, useIssueInvoice, useInvoices, useActivePaymentMethods, useSales } from './api';

interface CartLine {
  product: Product;
  quantity: number;
}

export function SalesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customerId, setCustomerId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cancelingSaleId, setCancelingSaleId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [refundReference, setRefundReference] = useState('');

  const productsQuery = useProducts(companyId, isPlatform);
  const customersQuery = useCustomers(companyId, isPlatform, '');
  const methodsQuery = useActivePaymentMethods(companyId ?? '', isPlatform);
  const cashQuery = useOpenCashSession(companyId, isPlatform);
  const salesQuery = useSales(companyId, isPlatform);
  const invoicesQuery = useInvoices(companyId, isPlatform);
  const createSale = useCreateSale(companyId, isPlatform);
  const cancelSale = useCancelSale(companyId, isPlatform);
  const issueInvoice = useIssueInvoice(companyId, isPlatform);
  
  const products = productsQuery.data?.items.filter((product) => product.isActive) ?? [];
  const customers = customersQuery.data?.items.filter((customer: Customer) => customer.is_active) ?? [];

  const methods = methodsQuery.data ?? [];
  const cashSession = cashQuery.data ?? null;
  const cashPaymentSelected = methods.find((method) => method.id === paymentMethodId)?.code === 'EFECTIVO';

  const invoicedSales = new Set(invoicesQuery.data?.items.map((invoice) => invoice.sale_id) ?? []);
  const salesList = salesQuery.data?.items ?? [];
  const salesTotal = salesQuery.data?.total ?? 0;

  const addProduct = () => {
    const product = products.find((item) => item.id === productId);
    if (!product || quantity <= 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + quantity } : line);
      return [...current, { product, quantity }];
    });
    setProductId('');
    setQuantity(1);
  };

  const submitSale = async () => {
    if (!paymentMethodId || cart.length === 0) return;
    try {
      const sale = await createSale.mutateAsync({
        customerId: customerId || null,
        ...(cashPaymentSelected && cashSession ? { cashSessionId: cashSession.id } : {}),
        paymentMethodId,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, discount: 0 })),
      });
      push('success', `Venta registrada: ${sale.currency} ${sale.total.toFixed(2)}.`);
      setCart([]);
      setCustomerId('');
      setPaymentMethodId('');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible registrar la venta.');
    }
  };

  const issue = async (saleId: string) => {
    try {
      const invoice = await issueInvoice.mutateAsync(saleId);
      push('success', `Factura ${invoice.full_number} emitida.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible emitir la factura.');
    }
  };

  const cancel = async (saleId: string) => {
    try {
      await cancelSale.mutateAsync({ saleId, reason: cancelReason.trim(), refundReference: refundReference.trim() || null });
      setCancelingSaleId('');
      setCancelReason('');
      setRefundReference('');
      push('success', 'Venta cancelada, reembolso registrado y existencias restauradas.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible cancelar la venta.');
    }
  };

  if (companyLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Ventas</h1><p className="muted">Selecciona una empresa para operar el punto de venta.</p></section>;

  const subtotal = cart.reduce((total, line) => total + line.product.price * line.quantity, 0);

  return (
    <div className="stack">
      <section className="card">
        <header className="page-header">
          <div><h1>Punto de venta</h1><p className="muted">El precio, los impuestos y las existencias se validan en el servidor.</p></div>
        </header>
        {productsQuery.isLoading || customersQuery.isLoading || methodsQuery.isLoading || cashQuery.isLoading ? <div className="center"><Spinner /></div> : (
          <>
            {(productsQuery.isError || customersQuery.isError || methodsQuery.isError) && <p className="field__error">No se pudieron cargar los datos del punto de venta.</p>}
            <div className="grid-2">
              <label className="field"><span>Producto</span>
                <select className="input" value={productId} onChange={(event) => setProductId(event.target.value)}>
                  <option value="">Selecciona un producto</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} · {product.price.toFixed(2)}</option>)}
                </select>
              </label>
              <label className="field"><span>Cantidad</span><NumberInput value={quantity} onValueChange={(v) => setQuantity(v ?? 0)} decimals={3} /></label>
            </div>
            <div style={{ marginTop: 12 }}><Button onClick={addProduct} disabled={!productId || quantity <= 0}>Agregar al carrito</Button></div>
            <div className="table-wrap" style={{ marginTop: 20 }}>
              <table className="table">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Importe</th><th>Acción</th></tr></thead>
                <tbody>{cart.map((line) => (
                  <tr key={line.product.id}>
                    <td>{line.product.name}</td><td>{line.quantity}</td><td>{line.product.price.toFixed(2)}</td>
                    <td>{(line.product.price * line.quantity).toFixed(2)}</td>
                    <td><Button variant="ghost" onClick={() => setCart((items) => items.filter((item) => item.product.id !== line.product.id))}>Quitar</Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="grid-2" style={{ marginTop: 16 }}>
              <label className="field"><span>Cliente</span>
                <select className="input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Venta sin cliente</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Método de pago</span>
                <select className="input" value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
                  <option value="">Selecciona un método</option>
                  {methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </label>
            </div>
            {cashPaymentSelected && !cashSession && <p className="field__error">Abre un turno de caja antes de cobrar en efectivo. Gestionar caja desde <a href="/caja">Caja</a>.</p>}
            <footer className="page-header" style={{ marginTop: 18, marginBottom: 0 }}>
              <strong>Subtotal estimado: {subtotal.toFixed(2)}</strong>
              <Button onClick={() => void submitSale()} disabled={!cart.length || !paymentMethodId || createSale.isPending || (cashPaymentSelected && !cashSession)}>
                {createSale.isPending ? 'Procesando…' : 'Cobrar y registrar venta'}
              </Button>
            </footer>
          </>
        )}
      </section>

      <section className="card">
        <header className="page-header"><div><h2>Ventas recientes</h2><p className="muted">{salesQuery.data ? `${salesTotal} venta(s)` : ''}</p></div></header>
        {salesQuery.isLoading ? <div className="center"><Spinner /></div> : salesQuery.isError ? (
          <p className="field__error">{salesQuery.error instanceof ApiError ? salesQuery.error.message : 'Error al cargar ventas.'}</p>
        ) : salesList.length === 0 ? <p className="muted">Aún no hay ventas.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Estado</th><th>Total</th><th>Moneda</th><th>Factura</th><th>Acciones</th></tr></thead>
            <tbody>{salesList.map((sale) => (
              <tr key={sale.id}>
                <td>{new Date(sale.sold_at).toLocaleString()}</td><td>{sale.status}</td><td>{sale.total.toFixed(2)}</td><td>{sale.currency}</td>
                <td>{invoicedSales.has(sale.id) ? 'Emitida' : <Button variant="ghost" onClick={() => void issue(sale.id)} disabled={issueInvoice.isPending}>Emitir factura</Button>}</td>
                <td>{sale.status === 'CANCELADA' ? '—' : cancelingSaleId === sale.id ? (
                  <div className="stack">
                    <input className="input" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo de cancelación" />
                    <input className="input" value={refundReference} onChange={(event) => setRefundReference(event.target.value)} placeholder="Referencia de reembolso externo" />
                    <Button variant="danger" onClick={() => void cancel(sale.id)} disabled={cancelSale.isPending || cancelReason.trim().length < 3}>Confirmar</Button>
                    <Button variant="ghost" onClick={() => setCancelingSaleId('')}>Cancelar</Button>
                  </div>
                ) : <Button variant="danger" onClick={() => { setCancelingSaleId(sale.id); setCancelReason(''); setRefundReference(''); }}>Cancelar venta</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}