import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useProducts, type Product } from '../products/api';
import { useSuppliers } from '../suppliers/api';
import { usePaymentMethods } from '../settings/api';
import { useCancelPurchase, useCreatePurchase, usePurchases } from './api';

interface PurchaseLine {
  product: Product;
  quantity: number;
  unitCost: number;
}

export function PurchasesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [supplierId, setSupplierId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [notes, setNotes] = useState('');
  const [cart, setCart] = useState<PurchaseLine[]>([]);
  const [cancelingId, setCancelingId] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const productsQuery = useProducts(companyId, isPlatform);
  const suppliersQuery = useSuppliers(companyId, isPlatform, '');
  const paymentMethodsQuery = usePaymentMethods(companyId ?? '', isPlatform);
  const purchasesQuery = usePurchases(companyId, isPlatform);
  const createPurchase = useCreatePurchase(companyId, isPlatform);
  const cancelPurchase = useCancelPurchase(companyId, isPlatform);
  const products = (productsQuery.data?.items ?? []).filter((product) => product.isActive && product.trackStock);
  const suppliers = (suppliersQuery.data?.items ?? []).filter((supplier) => supplier.is_active);
  const paymentMethods = (paymentMethodsQuery.data ?? []).filter((method) => method.is_active);

  const selectProduct = (id: string) => {
    setProductId(id);
    const product = products.find((item) => item.id === id);
    setUnitCost(product?.cost ?? product?.price ?? 0);
  };

  const addLine = () => {
    const product = products.find((item) => item.id === productId);
    if (!product || quantity <= 0 || unitCost < 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + quantity, unitCost } : line);
      return [...current, { product, quantity, unitCost }];
    });
    setProductId('');
    setQuantity(1);
    setUnitCost(0);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supplierId || cart.length === 0) return;
    try {
      await createPurchase.mutateAsync({
        supplierId,
        paymentMethodId: paymentMethodId || null,
        notes: notes.trim() || null,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitCost: line.unitCost })),
      });
      push('success', 'Recepción registrada y existencias actualizadas.');
      setCart([]);
      setNotes('');
      setPaymentMethodId('');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible registrar la compra.');
    }
  };

  const cancel = async (purchaseId: string) => {
    if (cancelReason.trim().length < 3) return;
    try {
      await cancelPurchase.mutateAsync({ purchaseId, reason: cancelReason.trim() });
      setCancelingId('');
      setCancelReason('');
      push('success', 'Compra anulada y existencias revertidas.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible anular la compra.');
    }
  };

  if (companyLoading || productsQuery.isLoading || suppliersQuery.isLoading || purchasesQuery.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Compras</h1><p className="muted">Selecciona una empresa para registrar recepciones.</p></section>;
  const error = productsQuery.error ?? suppliersQuery.error ?? purchasesQuery.error;
  if (error) return <section className="card"><p className="field__error">{error instanceof ApiError ? error.message : 'No fue posible cargar compras.'}</p></section>;

  return (
    <div className="stack">
      <section className="card">
        <header className="page-header"><div><h1>Recepción de compras</h1><p className="muted">La recepción incrementa existencias y conserva el costo de cada línea.</p></div></header>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>Proveedor</span><select className="input" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required><option value="">Selecciona proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <div className="grid-2">
            <label className="field"><span>Método de pago (opcional)</span><select className="input" value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}><option value="">{paymentMethodsQuery.isLoading ? 'Cargando métodos de pago…' : 'Pendiente / no registrado'}</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select>{paymentMethodsQuery.isError && <span className="field__hint">No se pudieron cargar métodos de pago; puedes guardar la recepción sin seleccionar uno.</span>}</label>
            <label className="field"><span>Producto</span><select className="input" value={productId} onChange={(event) => selectProduct(event.target.value)}><option value="">Selecciona producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
            <label className="field"><span>Cantidad</span><input className="input" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            <label className="field"><span>Costo unitario</span><input className="input" type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(Number(event.target.value))} /></label>
            <div className="field"><span>&nbsp;</span><Button type="button" variant="ghost" onClick={addLine} disabled={!productId || quantity <= 0}>Agregar línea</Button></div>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Costo</th><th>Importe</th><th></th></tr></thead>
            <tbody>{cart.map((line) => <tr key={line.product.id}><td>{line.product.sku}</td><td>{line.product.name}</td><td>{line.quantity}</td><td>{line.unitCost.toFixed(2)}</td><td>{(line.unitCost * line.quantity).toFixed(2)}</td><td><Button type="button" variant="ghost" onClick={() => setCart((items) => items.filter((item) => item.product.id !== line.product.id))}>Quitar</Button></td></tr>)}</tbody>
          </table></div>
          <label className="field"><span>Notas de recepción</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div><Button type="submit" disabled={!supplierId || !cart.length || createPurchase.isPending}>{createPurchase.isPending ? 'Registrando…' : 'Registrar recepción'}</Button></div>
        </form>
      </section>

      <section className="card">
        <header className="page-header"><div><h2>Recepciones recientes</h2><p className="muted">{purchasesQuery.data?.total ?? 0} compra(s)</p></div></header>
        {(purchasesQuery.data?.items.length ?? 0) === 0 ? <p className="muted">No hay recepciones registradas.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Método de pago</th><th>Estado</th><th>Total</th><th>Anulación</th></tr></thead>
            <tbody>{purchasesQuery.data!.items.map((purchase) => (
              <tr key={purchase.id}>
                <td>{new Date(purchase.received_at).toLocaleString()}</td><td>{purchase.supplier_name}</td><td>{purchase.payment_method_name ?? 'Pendiente / no registrado'}</td><td>{purchase.status}</td><td>{purchase.currency} {purchase.total.toFixed(2)}</td>
                <td>{purchase.status === 'ANULADA' ? '—' : cancelingId === purchase.id ? (
                  <div className="stack"><input className="input" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo (mínimo 3 caracteres)" /><Button variant="danger" onClick={() => void cancel(purchase.id)} disabled={cancelPurchase.isPending || cancelReason.trim().length < 3}>Confirmar</Button><Button variant="ghost" onClick={() => setCancelingId('')}>Cancelar</Button></div>
                ) : <Button variant="danger" onClick={() => { setCancelingId(purchase.id); setCancelReason(''); }}>Anular</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
