import type { PoolClient } from 'pg';

export interface LicenseRow {
  id: string;
  company_id: string;
  status: string;
  duration_seconds: string;
  max_users: number;
  starts_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface UserLicenseRow {
  id: string;
  company_id: string;
  user_id: string;
  status: string;
  duration_seconds: string;
  starts_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface RegistrationLicenseRow {
  id: string;
  status: string;
  duration_seconds: string;
  max_users: number;
  created_at: Date;
}

// ---------------------------------------------------------------- licencias de empresa

export async function insertLicense(
  c: PoolClient,
  p: { companyId: string; keyHash: string; durationSeconds: number; maxUsers: number; createdBy: string | null },
): Promise<LicenseRow> {
  const r = await c.query<LicenseRow>(
    `INSERT INTO licenses (company_id, key_hash, duration_seconds, max_users, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, status, duration_seconds, max_users, starts_at, expires_at, created_at`,
    [p.companyId, p.keyHash, p.durationSeconds, p.maxUsers, p.createdBy],
  );
  return r.rows[0]!;
}

export async function listLicenses(c: PoolClient, companyId: string): Promise<LicenseRow[]> {
  const r = await c.query<LicenseRow>(
    `SELECT id, company_id, status, duration_seconds, max_users, starts_at, expires_at, created_at
       FROM licenses WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId],
  );
  return r.rows;
}

export async function getLicense(c: PoolClient, id: string): Promise<LicenseRow | null> {
  const r = await c.query<LicenseRow>(
    `SELECT id, company_id, status, duration_seconds, max_users, starts_at, expires_at, created_at
       FROM licenses WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function setLicenseStatus(c: PoolClient, id: string, status: 'SUSPENDIDA' | 'REVOCADA' | 'ACTIVA'): Promise<void> {
  await c.query('SELECT set_license_status($1, $2)', [id, status]);
}

export async function hasActiveLicense(c: PoolClient, companyId: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM licenses
      WHERE company_id = $1 AND status = 'ACTIVA'
        AND starts_at IS NOT NULL AND starts_at <= now()
        AND expires_at IS NOT NULL AND expires_at > now()
      LIMIT 1`,
    [companyId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- licencias de usuario

export async function insertUserLicense(
  c: PoolClient,
  p: { companyId: string; userId: string; keyHash: string; durationSeconds: number; createdBy: string | null },
): Promise<UserLicenseRow> {
  const r = await c.query<UserLicenseRow>(
    `INSERT INTO user_licenses (company_id, user_id, key_hash, duration_seconds, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, user_id, status, duration_seconds, starts_at, expires_at, created_at`,
    [p.companyId, p.userId, p.keyHash, p.durationSeconds, p.createdBy],
  );
  return r.rows[0]!;
}

export async function insertRegistrationLicense(
  c: PoolClient,
  p: { keyHash: string; durationSeconds: number; maxUsers: number; createdBy: string | null },
): Promise<RegistrationLicenseRow> {
  const r = await c.query<RegistrationLicenseRow>(
    `INSERT INTO registration_licenses (key_hash, duration_seconds, max_users, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, status, duration_seconds, max_users, created_at`,
    [p.keyHash, p.durationSeconds, p.maxUsers, p.createdBy],
  );
  return r.rows[0]!;
}

export async function listUserLicenses(c: PoolClient, companyId: string, userId: string): Promise<UserLicenseRow[]> {
  const r = await c.query<UserLicenseRow>(
    `SELECT id, company_id, user_id, status, duration_seconds, starts_at, expires_at, created_at
       FROM user_licenses WHERE company_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [companyId, userId],
  );
  return r.rows;
}

export async function getUserLicense(c: PoolClient, id: string): Promise<UserLicenseRow | null> {
  const r = await c.query<UserLicenseRow>(
    `SELECT id, company_id, user_id, status, duration_seconds, starts_at, expires_at, created_at
       FROM user_licenses WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function setUserLicenseStatus(
  c: PoolClient,
  id: string,
  status: 'SUSPENDIDA' | 'REVOCADA' | 'ACTIVA',
): Promise<void> {
  await c.query('SELECT set_user_license_status($1, $2)', [id, status]);
}

export async function hasActiveUserLicense(c: PoolClient, companyId: string, userId: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM user_licenses
      WHERE company_id = $1 AND user_id = $2 AND status = 'ACTIVA'
        AND starts_at IS NOT NULL AND starts_at <= now()
        AND expires_at IS NOT NULL AND expires_at > now()
      LIMIT 1`,
    [companyId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function countActiveCompanyUsers(c: PoolClient, companyId: string): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM company_users WHERE company_id = $1 AND status = 'ACTIVO'`,
    [companyId],
  );
  return Number(r.rows[0]!.n);
}
