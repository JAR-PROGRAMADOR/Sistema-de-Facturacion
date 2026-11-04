import { useState } from 'react';
import { useToast } from '../../shared/ui/Toast';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { Spinner } from '../../shared/ui/Spinner';
import type { Role } from '../../shared/api/types';
import { useRoles, useDeleteRole } from './api';
import { RoleForm } from './RoleForm';
import { PermissionEditor } from './PermissionEditor';

export function RolesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);

  const query = useRoles(companyId, isPlatform);
  const deleteMutation = useDeleteRole(companyId, isPlatform);

  if (companyLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) {
    return (
      <section className="card">
        <h1>Roles</h1>
        <p className="muted">
          Selecciona una empresa en el header para gestionar sus roles.
        </p>
      </section>
    );
  }

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (r: Role) => { setEditing(r); setFormOpen(true); };

  const handleDelete = async (role: Role) => {
    if (role.isSystem) {
      push('error', 'No se puede eliminar un rol del sistema.');
      return;
    }
    if (!window.confirm(`¿Eliminar el rol "${role.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(role.id);
      push('success', 'Rol eliminado.');
    } catch (err: unknown) {
      push(
        'error',
        err instanceof ApiError ? err.message : 'No fue posible eliminar.',
      );
    }
  };

  return (
    <section className="card">
      <header className="page-header">
        <div>
          <h1>Roles</h1>
          <p className="muted">
            {query.data ? `${query.data.length} rol(es)` : 'Cargando…'}
          </p>
        </div>
        <Button onClick={openCreate}>Nuevo rol</Button>
      </header>

      {query.isLoading ? (
        <div className="center"><Spinner /></div>
      ) : query.isError ? (
        <p className="field__error">
          {query.error instanceof ApiError ? query.error.message : 'Error al cargar roles.'}
        </p>
      ) : !query.data || query.data.length === 0 ? (
        <p className="muted">No hay roles todavía.</p>
      ) : (
        <ul className="role-list">
          {query.data.map((role) => {
            const expanded = expandedRoleId === role.id;
            return (
              <li key={role.id} className="role-list__item">
                <div className="role-list__row">
                  <button
                    type="button"
                    className="role-list__toggle"
                    onClick={() => setExpandedRoleId(expanded ? null : role.id)}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>

                  <div className="role-list__main">
                    <div className="role-list__name">
                      <strong>{role.name}</strong>
                      {role.isSystem && <span className="badge">Sistema</span>}
                    </div>
                    {role.description && (
                      <div className="muted">{role.description}</div>
                    )}
                    <div className="muted">
                      {role.permissionCodes.length} permiso(s)
                    </div>
                  </div>

                  <div className="row-actions">
                    <Button variant="ghost" onClick={() => openEdit(role)}>
                      Editar
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(role)}
                      disabled={role.isSystem || deleteMutation.isPending}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>

                {expanded && (
                  <div className="role-list__expanded">
                    <PermissionEditor
                      role={role}
                      companyId={companyId}
                      isPlatform={isPlatform}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <RoleForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={editing}
        companyId={companyId}
        isPlatform={isPlatform}
      />
    </section>
  );
}