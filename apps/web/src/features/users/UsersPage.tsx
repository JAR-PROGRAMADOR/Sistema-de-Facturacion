import { useMemo, useState } from 'react';
import { ApiError } from '../../shared/api/error';
import type { Role, User } from '../../shared/api/types';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Button } from '../../shared/auth/Button';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useRoles } from '../roles/api';
import {
  useCreateUser,
  useDeactivateUser,
  useUpdateUser,
  useUsers,
  type CreateUserInput,
  type UpdateUserInput,
} from './api';

const emptyForm = (): CreateUserInput => ({
  email: '',
  password: '',
  fullName: '',
  locale: 'es',
  roleIds: [],
});

export function UsersPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<CreateUserInput>(emptyForm());

  const usersQuery = useUsers(companyId, isPlatform);
  const rolesQuery = useRoles(companyId, isPlatform);
  const createMutation = useCreateUser(companyId, isPlatform);
  const updateMutation = useUpdateUser(companyId, isPlatform, editing?.id ?? '');
  const deactivateMutation = useDeactivateUser(companyId, isPlatform);

  const items = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setForm({
      email: user.email,
      password: '',
      fullName: user.fullName,
      locale: user.locale as 'es' | 'en' | 'tr' | 'zh-CN' | 'ja' | 'ko',
      roleIds: user.roles.map((r) => r.id),
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

    const payload: CreateUserInput = {
      email: form.email.trim(),
      password: form.password.trim(),
      fullName: form.fullName.trim(),
      locale: form.locale,
      roleIds: form.roleIds,
    };

    try {
      if (editing) {
        const patch: UpdateUserInput = {
          fullName: payload.fullName,
          locale: payload.locale,
          roleIds: payload.roleIds,
          ...(payload.password ? { password: payload.password } : {}),
        };
        await updateMutation.mutateAsync(patch);
        push('success', `Usuario "${payload.fullName}" actualizado.`);
      } else {
        if (payload.password.length < 8) {
          throw new Error('La contraseña debe tener al menos 8 caracteres.');
        }
        await createMutation.mutateAsync(payload);
        push('success', `Usuario "${payload.fullName}" creado.`);
      }
      closeForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible guardar el usuario.';
      push('error', message);
    }
  };

  const deactivate = async (user: User) => {
    if (user.status === 'INACTIVO') return;
    try {
      await deactivateMutation.mutateAsync(user.id);
      push('success', `Usuario "${user.email}" desactivado.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No fue posible desactivar el usuario.';
      push('error', message);
    }
  };

  if (companyLoading) {
    return <div className="center"><Spinner /></div>;
  }

  if (!companyId) {
    return (
      <section className="card">
        <h1>Usuarios</h1>
        <p className="muted">Selecciona una empresa para ver y gestionar los usuarios.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p className="muted">
            {usersQuery.data ? `${usersQuery.data.total} usuario(s)` : 'Cargando…'}
          </p>
        </div>
        <Button onClick={openCreate}>Nuevo usuario</Button>
      </header>

      {usersQuery.isLoading || rolesQuery.isLoading ? (
        <div className="center"><Spinner /></div>
      ) : usersQuery.isError ? (
        <p className="field__error">
          {usersQuery.error instanceof ApiError ? usersQuery.error.message : 'Error al cargar usuarios.'}
        </p>
      ) : items.length === 0 ? (
        <p className="muted">No hay usuarios en esta empresa.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Roles</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.fullName}</strong>
                    <div className="muted">{user.email}</div>
                  </td>
                  <td>
                    {user.roles.length > 0 ? user.roles.map((role) => role.name).join(', ') : 'Sin roles'}
                  </td>
                  <td>
                    <span className={`badge ${user.status === 'ACTIVO' ? 'badge--success' : 'badge--warn'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <Button variant="ghost" onClick={() => openEdit(user)}>
                      Editar
                    </Button>
                    <Button variant="danger" onClick={() => void deactivate(user)} disabled={user.status === 'INACTIVO'}>
                      Desactivar
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
              <h2>{editing ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            </header>

            <div className="modal__body">
              <label className="field">
                <span>Nombre completo *</span>
                <input
                  value={form.fullName}
                  onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  required
                />
              </label>

              <label className="field">
                <span>Correo *</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  required
                  disabled={!!editing}
                />
              </label>

              <label className="field">
                <span>{editing ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  minLength={8}
                  required={!editing}
                />
              </label>

              <label className="field">
                <span>Locale</span>
                <select
                  value={form.locale}
                  onChange={(e) => setForm((prev) => ({ ...prev, locale: e.target.value as 'es' | 'en' | 'tr' | 'zh-CN' | 'ja' | 'ko' }))}
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="tr">Türkçe</option>
                  <option value="zh-CN">中文</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                </select>
              </label>

              <label className="field">
                <span>Roles</span>
                <select
                  multiple
                  size={Math.min(Math.max(roles.length, 3), 8)}
                  value={form.roleIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (option) => option.value);
                    setForm((prev) => ({ ...prev, roleIds: selected }));
                  }}
                >
                  {roles.map((role: Role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <footer className="modal__footer">
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear usuario'}
              </Button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
