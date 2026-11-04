import { useState } from 'react';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { useCreateProduct, useProducts, type ProductInput } from './api';
import { useCategories } from './categories-api';

const emptyForm: ProductInput = {
  sku: '',
  name: '',
  categoryId: null,
  description: '',
  price: 0,
  cost: 0,
  type: 'BIEN',
  trackStock: true,
  minStock: 0,
  initialStock: 0,
};

export function ProductsPage() {
  const { companyId, isPlatform } = useActiveCompany();
  const { data, isLoading } = useProducts(companyId, isPlatform);
  const categoriesQuery = useCategories(companyId, isPlatform);
  const createProduct = useCreateProduct(companyId, isPlatform);
  const [form, setForm] = useState<ProductInput>(emptyForm);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    createProduct.mutate({ ...form, price: Number(form.price), cost: Number(form.cost ?? 0), minStock: Number(form.minStock ?? 0), initialStock: Number(form.initialStock ?? 0) });
  };

  if (!companyId) {
    return <div className="panel"><p>Selecciona una empresa para gestionar productos.</p></div>;
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Productos</h2>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            SKU
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </label>
          <label>
            Nombre
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Categoría
            <select value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value || null })}>
              <option value="">Sin categoría</option>
              {(categoriesQuery.data?.items ?? []).filter((category) => category.is_active).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'BIEN' | 'SERVICIO' })}>
              <option value="BIEN">Bien</option>
              <option value="SERVICIO">Servicio</option>
            </select>
          </label>
          <label>
            Precio
            <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
          </label>
          <label>
            Costo
            <input type="number" min="0" step="0.01" value={form.cost ?? 0} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} />
          </label>
          <label>
            Stock mínimo
            <input type="number" min="0" step="1" value={form.minStock ?? 0} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
          </label>
          <label>
            Stock inicial
            <input type="number" min="0" step="1" value={form.initialStock ?? 0} onChange={(e) => setForm({ ...form, initialStock: Number(e.target.value) })} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.trackStock ?? true} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} />
            Controlar stock
          </label>
          <label className="full-width">
            Descripción
            <textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <div className="full-width">
            <button type="submit" className="button" disabled={createProduct.isPending}>
              {createProduct.isPending ? 'Guardando...' : 'Guardar producto'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Listado</h3>
        {isLoading ? <p>Cargando...</p> : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Precio</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((product) => (
                <tr key={product.id}>
                  <td>{product.sku}</td>
                  <td>{product.name}</td>
                  <td>{product.type}</td>
                  <td>{product.price.toFixed(2)}</td>
                  <td>{product.trackStock ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
