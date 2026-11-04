import { useMemo, useState } from 'react';
import { Button } from '../../shared/auth/Button';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { ApiError } from '../../shared/api/error';
import type { Permission, Role } from '../../shared/api/types';
import { usePermissions, useSetRolePermissions } from './api';

function groupByNamespace(perms: Permission[]): Map<string, Permission[]> {
  const m = new Map<string, Permission[]>();
  for (const p of perms) {
    const [ns] = p.code.split(':');
    const key = ns ?? 'otros';
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(p);
  }
  return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

interface Props {
  role: Role;
  companyId: string | null;
  isPlatform: boolean;
}

export function PermissionEditor({ role, companyId, isPlatform }: Props) {
  const { push } = useToast();
  const permsQuery = usePermissions();
  const mutation = useSetRolePermissions(companyId, isPlatform, role.id);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role.permissionCodes),
  );

  const groups = useMemo<Map<string, Permission[]>>(
    () => (permsQuery.data ? groupByNamespace(permsQuery.data) : new Map()),
    [permsQuery.data],
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleGroup = (codes: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  };

  const save = async () => {
    try {
      await mutation.mutateAsync([...selected]);
      push('success', 'Permisos actualizados.');
    } catch (err: unknown) {
      push(
        'error',
        err instanceof ApiError ? err.message : 'No fue posible guardar.',
      );
    }
  };

  if (permsQuery.isLoading) {
    return <div className="center"><Spinner /></div>;
  }
  if (permsQuery.isError || !permsQuery.data) {
    return <p className="field__error">No fue posible cargar el catálogo.</p>;
  }

  const dirty =
    selected.size !== role.permissionCodes.length ||
    role.permissionCodes.some((c) => !selected.has(c));

  return (
    <div className="perm-editor">
      <div className="perm-editor__groups">
        {[...groups.entries()].map(([ns, perms]) => {
          const allOn = perms.every((p: Permission) => selected.has(p.code));
          return (
            <section key={ns} className="perm-group">
              <header className="perm-group__header">
                <label className="perm-group__title">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) =>
                      toggleGroup(perms.map((p: Permission) => p.code), e.target.checked)
                    }
                  />
                  <strong>{ns}</strong>
                </label>
              </header>
              <ul className="perm-group__list">
                {perms.map((p: Permission) => (
                  <li key={p.code}>
                    <label className="perm-item">
                      <input
                        type="checkbox"
                        checked={selected.has(p.code)}
                        onChange={() => toggle(p.code)}
                      />
                      <span>
                        <code>{p.code}</code>
                        <span className="muted"> — {p.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="perm-editor__footer">
        <span className="muted">{selected.size} permisos seleccionados</span>
        <Button onClick={save} disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar permisos'}
        </Button>
      </footer>
    </div>
  );
}