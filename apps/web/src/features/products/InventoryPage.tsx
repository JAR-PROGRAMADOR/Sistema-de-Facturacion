import { useState } from 'react';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { NumberInput } from '../../shared/ui/NumberInput';
import { useAdjustStock, useInventory } from './api';

export function InventoryPage() {
  const { companyId, isPlatform } = useActiveCompany();
  const { data, isLoading } = useInventory(companyId, isPlatform);
  const adjustStock = useAdjustStock(companyId, isPlatform);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [type, setType] = useState<'ENTRADA' | 'SALIDA' | 'AJUSTE'>('ENTRADA');
  const [reason, setReason] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !productId) return;
    adjustStock.mutate({ productId, quantity: Number(quantity), type, reason: reason || null });
  };

  if (!companyId) {
    return <div className="panel"><p>Selecciona una empresa para gestionar inventario.</p></div>;
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Inventario</h2>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            Producto
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Seleccione</option>
              {(data?.items ?? []).map((item) => (
                <option key={item.product_id} value={item.product_id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select value={type} onChange={(e) => setType(e.target.value as 'ENTRADA' | 'SALIDA' | 'AJUSTE')}>
              <option value="ENTRADA">Entrada</option>
              <option value="SALIDA">Salida</option>
              <option value="AJUSTE">Ajuste</option>
            </select>
          </label>
          <label>
            Cantidad
            <NumberInput value={quantity} onValueChange={(v) => setQuantity(v ?? 0)} decimals={0} />
          </label>
          <label className="full-width">
            Motivo
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="full-width">
            <button type="submit" className="button" disabled={adjustStock.isPending}>Registrar movimiento</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Existencias</h3>
        {isLoading ? <p>Cargando...</p> : (
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU</th>
                <th>Cantidad</th>
                <th>Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => (
                <tr key={item.product_id}>
                  <td>{item.name}</td>
                  <td>{item.sku}</td>
                  <td>{item.quantity}</td>
                  <td>{item.min_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
