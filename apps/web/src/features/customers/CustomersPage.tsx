import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import {
  useCreateCustomer,
  useCustomers,
  useDeactivateCustomer,
  useUpdateCustomer,
  type Customer,
  type CustomerInput,
} from './api';

const emptyForm = (): CustomerInput => ({ name: '', taxId: '', email: '', phone: '', address: '', notes: '' });

export function CustomersPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerInput>(emptyForm());

  const customersQuery = useCustomers(companyId, isPlatform, search);
  const createMutation = useCreateCustomer(companyId, isPlatform);
  const updateMutation = useUpdateCustomer(companyId, isPlatform, editing?.id ?? '');
  const deactivateMutation = useDeactivateCustomer(companyId, isPlatform);
  const customers = customersQuery.data?.items ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      taxId: customer.tax_id ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: CustomerInput = {
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
        push('success', `Cliente "${payload.name}" actualizado.`);
      } else {
        await createMutation.mutateAsync(payload);
        push('success', `Cliente "${payload.name}" creado.`);
      }
      closeForm();
    } catch (error) {
      push('error', error instanceof Error ? error.message : 'No fue posible guardar el cliente.');
    }
  };

  const deactivate = async (customer: Customer) => {
    if (!customer.is_active) return;
    try {
      await deactivateMutation.mutateAsync(customer.id);
      push('success', `Cliente "${customer.name}" desactivado.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible desactivar el cliente.');
    }
  };

  if (companyLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) {
    return <section className="card"><h1>Clientes</h1><p className="muted">Selecciona una empresa para gestionar sus clientes.</p></section>;
  }

  return (
    <section className="card">
      <header className="page-header">
        <div>
          <h1>Clientes</h1>
          <p className="muted">{customersQuery.data ? `${customersQuery.data.total} cliente(s)` : 'Cargando…'}</p>
        </div>
        <Button onClick={openCreate}>Nuevo cliente</Button>
      </header>

      <div className="filters">
        <label className="field">
          <span>Buscar</span>
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, identificación o correo" />
        </label>
      </div>

      {customersQuery.isLoading ? (
        <div className="center"><Spinner /></div>
      ) : customersQuery.isError ? (
        <p className="field__error">{customersQuery.error instanceof ApiError ? customersQuery.error.message : 'Error al cargar clientes.'}</p>
      ) : customers.length === 0 ? (
        <p className="muted">No hay clientes que coincidan con la búsqueda.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Cliente</th><th>Identificación</th><th>Contacto</th><th>Estado</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td><strong>{customer.name}</strong>{customer.address && <div className="muted">{customer.address}</div>}</td>
                  <td>{customer.tax_id || '—'}</td>
                  <td>{customer.email || customer.phone || '—'}{customer.email && customer.phone && <div className="muted">{customer.phone}</div>}</td>
                  <td><span className={`status ${customer.is_active ? 'status--ok' : 'status--off'}`}>{customer.is_active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="row-actions">
                    <Button variant="ghost" onClick={() => openEdit(customer)}>Editar</Button>
                    <Button variant="danger" onClick={() => void deactivate(customer)} disabled={!customer.is_active || deactivateMutation.isPending}>Desactivar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="modal-overlay" onMouseDown={closeForm}>
          <form className="modal card" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
            <header className="modal__header"><h2>{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2></header>
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
