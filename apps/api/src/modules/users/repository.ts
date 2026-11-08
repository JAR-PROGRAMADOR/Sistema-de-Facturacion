import type { PoolClient } from 'pg';

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  locale: string;
  status: string;
  is_platform_admin: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface MembershipWithUserRow {
  user_id: string;
  email: string;
  full_name: string;
  locale: string;
  is_platform_admin: boolean;
  created_at: Date;
  last_login_at: Date | null;
  membership_status: string;
  role_id: string;
  role_name: string;
}

const USER_COLS = `id, email, full_name, locale, status, is_platform_admin,
                   created_at, updated_at, last_login_at`;

const MEMBERSHIP_SELECT = `
  SELECT u.id AS user_id, u.email, u.full_name, u.locale, u.is_platform_admin,
         u.created_at, u.last_login_at,
         cu.status AS membership_status,
         r.id AS role_id, r.name AS role_name
    FROM company_users cu
    JOIN users u ON u.id = cu.user_id
    JOIN roles r ON r.id = cu.role_id
`;

export async function findUserByEmail(c: PoolClient, email: string): Promise<UserRow | null> {
  const r = await c.query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return r.rows[0] ?? null;
}

export async function insertUser(
  c: PoolClient,
  p: { id: string; email: string; passwordHash: string; fullName: string; locale: string },
): Promise<void> {
  await c.query(
    `INSERT INTO users (id, email, password_hash, full_name, locale, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVO')`,
    [p.id, p.email, p.passwordHash, p.fullName, p.locale],
  );
}

export async function updateUser(
  c: PoolClient,
  id: string,
  patch: { full_name?: string; locale?: string; password_hash?: string },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    args.push(v);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) return;
  await c.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, args);
}

export async function listMembershipsByCompany(
  c: PoolClient,
  companyId: string,
  q: { limit: number; offset: number; search?: string; status?: string; roleId?: string },
): Promise<MembershipWithUserRow[]> {
  const where: string[] = ['cu.company_id = $1'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(u.full_name) LIKE $${args.length} OR lower(u.email) LIKE $${args.length})`);
  }
  if (q.status) {
    args.push(q.status);
    where.push(`cu.status = $${args.length}`);
  }
  if (q.roleId) {
    args.push(q.roleId);
    where.push(`cu.role_id = $${args.length}`);
  }

  args.push(q.limit, q.offset);

  const r = await c.query<MembershipWithUserRow>(
    `${MEMBERSHIP_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY u.full_name, r.name
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return r.rows;
}

export async function countMembershipsByCompany(
  c: PoolClient,
  companyId: string,
  q: { search?: string; status?: string; roleId?: string },
): Promise<number> {
  const where: string[] = ['cu.company_id = $1'];
  const args: unknown[] = [companyId];
  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(u.full_name) LIKE $${args.length} OR lower(u.email) LIKE $${args.length})`);
  }
  if (q.status) {
    args.push(q.status);
    where.push(`cu.status = $${args.length}`);
  }
  if (q.roleId) {
    args.push(q.roleId);
    where.push(`cu.role_id = $${args.length}`);
  }
  const r = await c.query<{ n: number }>(
    `SELECT count(DISTINCT cu.user_id)::int AS n
       FROM company_users cu
       JOIN users u ON u.id = cu.user_id
      WHERE ${where.join(' AND ')}`,
    args,
  );
  return r.rows[0]?.n ?? 0;
}

export async function findMembershipsByUser(
  c: PoolClient,
  companyId: string,
  userId: string,
): Promise<MembershipWithUserRow[]> {
  const r = await c.query<MembershipWithUserRow>(
    `${MEMBERSHIP_SELECT}
     WHERE cu.company_id = $1 AND cu.user_id = $2
     ORDER BY r.name`,
    [companyId, userId],
  );
  return r.rows;
}

export async function insertMembership(
  c: PoolClient,
  companyId: string,
  userId: string,
  roleId: string,
  status: 'ACTIVO' | 'INACTIVO' = 'ACTIVO',
): Promise<void> {
  await c.query(
    `INSERT INTO company_users (company_id, user_id, role_id, status)
     VALUES ($1, $2, $3, $4)`,
    [companyId, userId, roleId, status],
  );
}

export async function deleteMemberships(
  c: PoolClient,
  companyId: string,
  userId: string,
): Promise<void> {
  await c.query(
    `DELETE FROM company_users WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId],
  );
}

export async function updateMembershipStatus(
  c: PoolClient,
  companyId: string,
  userId: string,
  status: 'ACTIVO' | 'INACTIVO',
): Promise<void> {
  await c.query(
    `UPDATE company_users SET status = $3 WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId, status],
  );
}

export async function rolesBelongToCompany(
  c: PoolClient,
  companyId: string,
  roleIds: string[],
): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const r = await c.query<{ id: string }>(
    `SELECT id FROM roles WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, roleIds],
  );
  return r.rows.map((x) => x.id);
}

export async function countActiveAdmins(c: PoolClient, companyId: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    `SELECT count(DISTINCT cu.user_id)::int AS n
       FROM company_users cu
       JOIN roles r ON r.id = cu.role_id
      WHERE cu.company_id = $1
        AND cu.status = 'ACTIVO'
        AND r.is_system = true
        AND lower(r.name) = 'administrador'`,
    [companyId],
  );
  return r.rows[0]?.n ?? 0;
}

export async function userHasAdminRole(
  c: PoolClient,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT 1
       FROM company_users cu
       JOIN roles r ON r.id = cu.role_id
      WHERE cu.company_id = $1
        AND cu.user_id = $2
        AND cu.status = 'ACTIVO'
        AND r.is_system = true
        AND lower(r.name) = 'administrador'
      LIMIT 1`,
    [companyId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function findAdminRoleId(
  c: PoolClient,
  companyId: string,
): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `SELECT id FROM roles
      WHERE company_id = $1 AND is_system = true AND lower(name) = 'administrador'
      LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.id ?? null;
}

export async function findSellerRoleId(
  c: PoolClient,
  companyId: string,
): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `SELECT id FROM roles
      WHERE company_id = $1 AND is_system = true AND lower(name) = 'vendedor'
      LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.id ?? null;
}