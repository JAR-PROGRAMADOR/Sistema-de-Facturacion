import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useLowStock, useSalesSummary, useTopProducts } from './api';

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);

export function ReportsPage() {
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [from, setFrom] = useState(() => dateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const sales = useSalesSummary(companyId, isPlatform, from, to);
  const topProducts = useTopProducts(companyId, isPlatform, from, to);
  const lowStock = useLowStock(companyId, isPlatform);

  if (companyLoading || sales.isLoading || topProducts.isLoading || lowStock.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Reportes</h1><p className="muted">Selecciona una empresa para ver sus reportes.</p></section>;
  const error = sales.error ?? topProducts.error ?? lowStock.error;
  if (error) return <section className="card"><p className="field__error">{error instanceof ApiError ? error.message : 'No fue posible cargar los reportes.'}</p></section>;

  return (
    <div className="stack">
      <section className="card">
        <header className="page-header"><div><h1>Reportes</h1><p className="muted">Ventas e inventario</p></div></header>
        <div className="grid-2">
          <label className="field"><span>Desde</span><input className="input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>Hasta</span><input className="input" type="date" value={to} min={from} max={dateInputValue(new Date())} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        <div className="grid-2" style={{ marginTop: 18 }}>
          <div><span className="muted">Ventas completadas</span><div><strong>{sales.data?.salesCount ?? 0}</strong></div></div>
          <div><span className="muted">Ingresos</span><div><strong>{sales.data?.total.toFixed(2) ?? '0.00'}</strong></div></div>
          <div><span className="muted">Impuestos</span><div><strong>{sales.data?.taxTotal.toFixed(2) ?? '0.00'}</strong></div></div>
          <div><span className="muted">Descuentos</span><div><strong>{sales.data?.discountTotal.toFixed(2) ?? '0.00'}</strong></div></div>
        </div>
      </section>

      <section className="card">
        <h2>Ventas por día</h2>
        {(sales.data?.daily.length ?? 0) === 0 ? <p className="muted">No hay ventas en este período.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Operaciones</th><th>Total</th></tr></thead>
            <tbody>{sales.data!.daily.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.salesCount}</td><td>{day.total.toFixed(2)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Productos más vendidos</h2>
        {(topProducts.data?.length ?? 0) === 0 ? <p className="muted">No hay productos vendidos en este período.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>SKU</th><th>Producto</th><th>Unidades</th><th>Ingresos</th></tr></thead>
            <tbody>{topProducts.data!.map((product) => <tr key={product.productId}><td>{product.sku}</td><td>{product.name}</td><td>{product.quantity}</td><td>{product.revenue.toFixed(2)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Stock bajo</h2>
        {(lowStock.data?.length ?? 0) === 0 ? <p className="muted">No hay productos bajo su mínimo.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>SKU</th><th>Producto</th><th>Existencias</th><th>Mínimo</th></tr></thead>
            <tbody>{lowStock.data!.map((product) => <tr key={product.productId}><td>{product.sku}</td><td>{product.name}</td><td>{product.quantity}</td><td>{product.minStock}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
