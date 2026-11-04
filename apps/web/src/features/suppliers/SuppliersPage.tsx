import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import {
  useCreateSupplier,
  useDeactivateSupplier,
  useSuppliers,
  useUpdateSupplier,
  type Supplier,
  type SupplierInput,
} from './api';

const emptyForm = (): SupplierInput => ({ name: '', taxId: '', email: '', phone: '', address: '', notes: '' });

export function SuppliersPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierInput>(emptyForm());

  const suppliersQuery = useSuppliers(companyId, isPlatform, search);
  const createMutation = useCreateSupplier(companyId, isPlatform);
  const updateMutation = useUpdateSupplier(companyId, isPlatform, editing?.id ?? '');
  const deactivateMutation = useDeactivateSupplier(companyId, isPlatform);
  const suppliers = suppliersQuery.data?.items ?? [];

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setForm({ name: supplier.name, taxId: supplier.tax_id ?? '', email: supplier.email ?? '', phone: supplier.phone ?? '', address: supplier.address ?? '', notes: supplier.notes ?? '' });
    setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); setEditing(null); setForm(emptyForm()); };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: SupplierInput = {
      name: form.name.trim(),
      taxId: form.taxId?.trim() || null,
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      notes: form.notes?.trim() || null,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync(payload);
        push('success', `Proveedor "${payload.name}" actualizado.`);
      } else {
        await createMutation.mutateAsync(payload);
        push('success', `Proveedor "${payload.name}" creado.`);
      }
      closeForm();
    } catch (error) {
      push('error', error instanceof Error ? error.message : 'No fue posible guardar el proveedor.');
    }
  };

  const deactivate = async (supplier: Supplier) => {
    if (!supplier.is_active) return;
    try {
      await deactivateMutation.mutateAsync(supplier.id);
      push('success', `Proveedor "${supplier.name}" desactivado.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible desactivar el proveedor.');
    }
  };

  if (companyLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Proveedores</h1><p className="muted">Selecciona una empresa para gestionar sus proveedores.</p></section>;

  return (
    <section className="card">
      <header className="page-header">
        <div><h1>Proveedores</h1><p className="muted">{suppliersQuery.data ? `${suppliersQuery.data.total} proveedor(es)` : 'Cargando…'}</p></div>
        <Button onClick={openCreate}>Nuevo proveedor</Button>
      </header>
      <div className="filters">
        <label className="field"><span>Buscar</span><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, identificación o correo" /></label>
      </div>
      {suppliersQuery.isLoading ? <div className="center"><Spinner /></div> : suppliersQuery.isError ? (
        <p className="field__error">{suppliersQuery.error instanceof ApiError ? suppliersQuery.error.message : 'Error al cargar proveedores.'}</p>
      ) : suppliers.length === 0 ? <p className="muted">No hay proveedores que coincidan con la búsqueda.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Proveedor</th><th>Identificación</th><th>Contacto</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td><strong>{supplier.name}</strong>{supplier.address && <div className="muted">{supplier.address}</div>}</td>
                <td>{supplier.tax_id || '—'}</td>
                <td>{supplier.email || supplier.phone || '—'}{supplier.email && supplier.phone && <div className="muted">{supplier.phone}</div>}</td>
                <td><span className={`status ${supplier.is_active ? 'status--ok' : 'status--off'}`}>{supplier.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td className="row-actions"><Button variant="ghost" onClick={() => openEdit(supplier)}>Editar</Button><Button variant="danger" onClick={() => void deactivate(supplier)} disabled={!supplier.is_active || deactivateMutation.isPending}>Desactivar</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {formOpen && (
        <div className="modal-overlay" onMouseDown={closeForm}>
          <form className="modal card" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
            <header className="modal__header"><h2>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</h2></header>
            <div className="modal__body">
              <label className="field"><span>Nombre *</span><input className="input" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required maxLength={200} /></label>
              <label className="field"><span>Identificación fiscal</span><input className="input" value={form.taxId ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))} maxLength={80} /></label>
              <label className="field"><span>Correo</span><input className="input" type="email" value={form.email ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} maxLength={255} /></label>
              <label className="field"><span>Teléfono</span><input className="input" value={form.phone ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} maxLength={40} /></label>
              <label className="field"><span>Dirección</span><input className="input" value={form.address ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} maxLength={500} /></label>
              <label className="field"><span>Notas</span><textarea className="input" rows={3} value={form.notes ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} maxLength={2000} /></label>
            </div>
            <footer className="modal__footer">
              <Button variant="ghost" type="button" onClick={closeForm}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>{createMutation.isPending || updateMutation.isPending ? 'Guardando…' : 'Guardar'}</Button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
