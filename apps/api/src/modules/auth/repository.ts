import type { PoolClient } from 'pg';

export interface UserAuthRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  locale: string;
  status: string;
  failed_login_attempts: number;
  locked_until: Date | null;
  is_platform_admin: boolean;
}

export interface Membership {
  company_id: string;
  company_name: string;
  role_id: string;
}

export interface SessionRow {
  id: string;
  family_id: string;
  user_id: string;
  company_id: string | null;
  token_hash: string;
  family_started_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
}

export interface PasswordResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export interface User2faRow {
  user_id: string;
  secret: string;
  enabled: boolean;
  confirmed_at: Date | null;
  recovery_codes_hash: string[];
}

export async function getUserByEmail(c: PoolClient, email: string): Promise<UserAuthRow | null> {
  const r = await c.query<UserAuthRow>('SELECT * FROM auth_get_user_by_email($1)', [email]);
  return r.rows[0] ?? null;
}

/**
 * Igual que getUserByEmail, pero bloquea la fila del usuario hasta el COMMIT, usando una
 * función SECURITY DEFINER (auth_get_user_for_login). Es necesario un camino aparte porque,
 * durante el login, todavía no hay empresa en el contexto y una consulta directa a `users`
 * quedaría bloqueada por sus políticas RLS, que exigen esa empresa.
 */
export async function getUserByEmailForUpdate(c: PoolClient, email: string): Promise<UserAuthRow | null> {
  const r = await c.query<UserAuthRow>('SELECT * FROM auth_get_user_for_login($1)', [email]);
  return r.rows[0] ?? null;
}

export async function getUserById(c: PoolClient, id: string): Promise<UserAuthRow | null> {
  const r = await c.query<UserAuthRow>(
    `SELECT id, email, password_hash, full_name, locale, status, failed_login_attempts,
            locked_until, is_platform_admin
       FROM users WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listMemberships(c: PoolClient, userId: string): Promise<Membership[]> {
  const r = await c.query<Membership>(
    'SELECT company_id, company_name, role_id FROM auth_list_memberships($1)',
    [userId],
  );
  return r.rows;
}

export async function getCompany(c: PoolClient, id: string): Promise<CompanyRow | null> {
  const r = await c.query<CompanyRow>(
    'SELECT id, name, currency, locale, timezone FROM companies WHERE id = $1',
    [id],
  );
  return r.rows[0] ?? null;
}

export async function recordFailedLogin(
  c: PoolClient,
  userId: string,
  attempts: number,
  lockedUntil: Date | null,
): Promise<void> {
  await c.query('UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1', [
    userId,
    attempts,
    lockedUntil,
  ]);
}

export async function recordSuccessfulLogin(c: PoolClient, userId: string): Promise<void> {
  await c.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [userId],
  );
}

export async function updatePassword(c: PoolClient, userId: string, passwordHash: string): Promise<void> {
  await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
}

export async function insertSession(
  c: PoolClient,
  s: {
    familyId: string;
    userId: string;
    companyId: string | null;
    tokenHash: string;
    familyStartedAt: Date;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO sessions (family_id, user_id, company_id, token_hash, family_started_at, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [s.familyId, s.userId, s.companyId, s.tokenHash, s.familyStartedAt, s.expiresAt, s.userAgent, s.ip],
  );
}

export async function findSessionForUpdate(c: PoolClient, tokenHash: string): Promise<SessionRow | null> {
  const r = await c.query<SessionRow>(
    `SELECT id, family_id, user_id, company_id, token_hash, family_started_at, expires_at, used_at, revoked_at
       FROM sessions WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function markSessionUsed(c: PoolClient, id: string): Promise<void> {
  await c.query('UPDATE sessions SET used_at = now() WHERE id = $1', [id]);
}

export async function revokeFamily(c: PoolClient, familyId: string): Promise<void> {
  await c.query('UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);
}

/** Revoca todas las sesiones del usuario, salvo (opcionalmente) la familia indicada. */
export async function revokeUserSessions(c: PoolClient, userId: string, exceptFamily: string | null): Promise<void> {
  await c.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR family_id <> $2::uuid)`,
    [userId, exceptFamily],
  );
}

export async function insertAudit(
  c: PoolClient,
  a: {
    companyId?: string | null;
    userId?: string | null;
    action: string;
    result?: 'OK' | 'ERROR';
    ip?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (company_id, user_id, action, result, ip, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [a.companyId ?? null, a.userId ?? null, a.action, a.result ?? 'OK', a.ip ?? null, JSON.stringify(a.metadata ?? {})],
  );
}

// ---------------------------------------------------------------- FASE 3b: recuperación

export async function insertPasswordReset(
  c: PoolClient,
  p: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await c.query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [p.userId, p.tokenHash, p.expiresAt],
  );
}

export async function findPasswordResetForUpdate(c: PoolClient, tokenHash: string): Promise<PasswordResetRow | null> {
  const r = await c.query<PasswordResetRow>(
    'SELECT id, user_id, token_hash, expires_at, used_at FROM password_resets WHERE token_hash = $1 FOR UPDATE',
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function markPasswordResetUsed(c: PoolClient, id: string): Promise<void> {
  await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- FASE 3b: 2FA

export async function getUser2fa(c: PoolClient, userId: string): Promise<User2faRow | null> {
  const r = await c.query<User2faRow>(
    'SELECT user_id, secret, enabled, confirmed_at, recovery_codes_hash FROM user_2fa WHERE user_id = $1',
    [userId],
  );
  return r.rows[0] ?? null;
}

/** Crea o reemplaza la configuración pendiente de 2FA (aún no confirmada/habilitada). */
export async function upsertPendingUser2fa(
  c: PoolClient,
  p: { userId: string; secret: string; recoveryCodesHash: string[] },
): Promise<void> {
  await c.query(
    `INSERT INTO user_2fa (user_id, secret, enabled, confirmed_at, recovery_codes_hash)
     VALUES ($1, $2, false, NULL, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET secret = EXCLUDED.secret, enabled = false, confirmed_at = NULL,
           recovery_codes_hash = EXCLUDED.recovery_codes_hash`,
    [p.userId, p.secret, p.recoveryCodesHash],
  );
}

export async function enableUser2fa(c: PoolClient, userId: string): Promise<void> {
  await c.query('UPDATE user_2fa SET enabled = true, confirmed_at = now() WHERE user_id = $1', [userId]);
}

export async function disableUser2fa(c: PoolClient, userId: string): Promise<void> {
  await c.query('DELETE FROM user_2fa WHERE user_id = $1', [userId]);
}

export async function consumeRecoveryCode(c: PoolClient, userId: string, codeHash: string): Promise<void> {
  await c.query(
    'UPDATE user_2fa SET recovery_codes_hash = array_remove(recovery_codes_hash, $2) WHERE user_id = $1',
    [userId, codeHash],
  );
}
