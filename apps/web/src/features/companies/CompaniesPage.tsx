import { useMemo, useState } from 'react';
import { ApiError } from '../../shared/api/error';
import type { Company } from '../../shared/api/types';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Button } from '../../shared/auth/Button';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import {
  useCompanies,
  useCreateCompany,
  useSetCompanyStatus,
  useUpdateCompany,
  type CompanyCreateInput,
  type CompanyUpdateInput,
} from './api';

const emptyForm = (): CompanyCreateInput => ({
  name: '',
  legalName: '',
  taxId: '',
  country: 'ES',
  currency: 'EUR',
  locale: 'es',
  timezone: 'Europe/Madrid',
});

export function CompaniesPage() {
  const { push } = useToast();
  const { isPlatform } = useActiveCompany();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyCreateInput>(emptyForm());

  const query = useCompanies();
  const createMutation = useCreateCompany();
  const updateMutation = useUpdateCompany();
  const statusMutation = useSetCompanyStatus();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    setForm({
      name: company.name,
      legalName: company.legal_name ?? '',
      taxId: company.tax_id ?? '',
      country: company.country ?? '',
      currency: company.currency,
      locale: company.locale,
      timezone: company.timezone,
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
    const payload: CompanyCreateInput = {
      name: form.name.trim(),
      legalName: form.legalName?.trim() ? form.legalName.trim() : null,
      taxId: form.taxId?.trim() ? form.taxId.trim() : null,
      country: form.country?.trim() ? form.country.trim() : null,
      currency: form.currency.trim() || 'EUR',
      locale: form.locale.trim() || 'es',
      timezone: form.timezone.trim() || 'UTC',
    };

    try {
      if (editing) {
        const input: CompanyUpdateInput = payload;
        await updateMutation.mutateAsync({ id: editing.id, input });
        push('success', `Empresa "${payload.name}" actualizada.`);
      } else {
        await createMutation.mutateAsync(payload);
        push('success', `Empresa "${payload.name}" creada.`);
      }
      closeForm();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No fue posible guardar la empresa.';
      push('error', message);
    }
  };

  const toggleStatus = async (company: Company) => {
    const nextStatus = company.status === 'ACTIVA' ? 'SUSPENDIDA' : 'ACTIVA';
    try {
      await statusMutation.mutateAsync({ id: company.id, status: nextStatus });
      push('success', `Empresa ${nextStatus === 'ACTIVA' ? 'activada' : 'suspendida'}.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No fue posible cambiar el estado.';
      push('error', message);
    }
  };

  if (!isPlatform) {
    return (
      <section className="card">
        <h1>Empresas</h1>
        <p className="muted">Esta vista solo está disponible para usuarios de plataforma.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="page-header">
        <div>
          <h1>Empresas</h1>
          <p className="muted">
            {query.data ? `${query.data.total} empresa(s)` : 'Cargando…'}
          </p>
        </div>
        <Button onClick={openCreate}>Nueva empresa</Button>
      </header>

      {query.isLoading ? (
        <div className="center"><Spinner /></div>
      ) : query.isError ? (
        <p className="field__error">
          {query.error instanceof ApiError ? query.error.message : 'Error al cargar empresas.'}
        </p>
      ) : items.length === 0 ? (
        <p className="muted">No hay empresas todavía.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>País</th>
                <th>Moneda</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((company) => (
                <tr key={company.id}>
                  <td>
                    <strong>{company.name}</strong>
                    {company.legal_name ? <div className="muted">{company.legal_name}</div> : null}
                  </td>
                  <td>{company.country ?? '—'}</td>
                  <td>{company.currency}</td>
                  <td>
                    <span className={`badge ${company.status === 'ACTIVA' ? 'badge--success' : 'badge--warn'}`}>
                      {company.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <Button variant="ghost" onClick={() => openEdit(company)}>
                      Editar
                    </Button>
                    <Button
                      variant={company.status === 'ACTIVA' ? 'danger' : 'primary'}
                      onClick={() => void toggleStatus(company)}
                      disabled={statusMutation.isPending}
                    >
                      {company.status === 'ACTIVA' ? 'Suspender' : 'Activar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="modal-overlay" onMouseDown={closeForm}>
          <form className="modal card" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
            <header className="modal__header">
              <h2>{editing ? 'Editar empresa' : 'Nueva empresa'}</h2>
            </header>

            <div className="modal__body">
              <label className="field">
                <span>Nombre *</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>

              <label className="field">
                <span>Razón social</span>
                <input
                  value={form.legalName ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, legalName: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>NIF / CIF</span>
                <input
                  value={form.taxId ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))}
                />
              </label>

              <div className="grid two-col">
                <label className="field">
                  <span>País</span>
                  <input
                    value={form.country ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Moneda</span>
                  <input
                    value={form.currency}
                    onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label className="field">
                  <span>Locale</span>
                  <input
                    value={form.locale}
                    onChange={(e) => setForm((prev) => ({ ...prev, locale: e.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Timezone</span>
                  <input
                    value={form.timezone}
                    onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            <footer className="modal__footer">
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear empresa'}
              </Button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
