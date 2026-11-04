import type { PoolClient } from 'pg';

export interface RoleRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
}

export interface PermissionRow {
  code: string;
  description: string;
}

const ROLE_COLS = `id, company_id, name, description, is_system, created_at`;

export async function listPermissions(c: PoolClient): Promise<PermissionRow[]> {
  const r = await c.query<PermissionRow>(
    `SELECT code, description FROM permissions ORDER BY code`,
  );
  return r.rows;
}

export async function findRoleById(
  c: PoolClient,
  companyId: string,
  id: string,
): Promise<RoleRow | null> {
  const r = await c.query<RoleRow>(
    `SELECT ${ROLE_COLS} FROM roles WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return r.rows[0] ?? null;
}

export async function listRoles(c: PoolClient): Promise<RoleRow[]> {
  const r = await c.query<RoleRow>(
    `SELECT ${ROLE_COLS} FROM roles ORDER BY is_system DESC, name ASC`,
  );
  return r.rows;
}

export async function listRolePermissionCodes(
  c: PoolClient,
  roleId: string,
): Promise<string[]> {
  const r = await c.query<{ permission_code: string }>(
    `SELECT permission_code FROM role_permissions
      WHERE role_id = $1 ORDER BY permission_code`,
    [roleId],
  );
  return r.rows.map((x) => x.permission_code);
}

export async function roleNameExists(
  c: PoolClient,
  companyId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM roles
      WHERE company_id = $1 AND lower(name) = lower($2)
        ${excludeId ? 'AND id <> $3' : ''}
      LIMIT 1`,
    excludeId ? [companyId, name, excludeId] : [companyId, name],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertRole(
  c: PoolClient,
  p: { id: string; companyId: string; name: string; description: string | null; isSystem: boolean },
): Promise<void> {
  await c.query(
    `INSERT INTO roles (id, company_id, name, description, is_system)
     VALUES ($1, $2, $3, $4, $5)`,
    [p.id, p.companyId, p.name, p.description, p.isSystem],
  );
}

export async function updateRole(
  c: PoolClient,
  companyId: string,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [id, companyId];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    args.push(v);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) return;
  await c.query(
    `UPDATE roles SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
    args,
  );
}

export async function deleteRole(
  c: PoolClient,
  companyId: string,
  id: string,
): Promise<void> {
  await c.query(`DELETE FROM roles WHERE id = $1 AND company_id = $2`, [id, companyId]);
}

export async function replaceRolePermissions(
  c: PoolClient,
  companyId: string,
  roleId: string,
  codes: string[],
): Promise<void> {
  await c.query(
    `DELETE FROM role_permissions WHERE role_id = $1 AND company_id = $2`,
    [roleId, companyId],
  );
  if (codes.length === 0) return;

  const values: string[] = [];
  const args: unknown[] = [companyId, roleId];
  for (const code of codes) {
    args.push(code);
    values.push(`($1, $2, $${args.length})`);
  }
  await c.query(
    `INSERT INTO role_permissions (company_id, role_id, permission_code)
     VALUES ${values.join(', ')}`,
    args,
  );
}

export async function countActiveUsersWithRole(
  c: PoolClient,
  roleId: string,
): Promise<number> {
  const r = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM company_users
      WHERE role_id = $1 AND status = 'ACTIVO'`,
    [roleId],
  );
  return r.rows[0]?.n ?? 0;
}