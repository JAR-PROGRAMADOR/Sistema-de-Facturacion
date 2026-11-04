import type { Pool } from 'pg';
import { withContext } from '../database/client.js';
import { AppError } from '../shared/errors.js';
import type { AccessClaims } from './authenticate.js';

interface LicenseRow {
  status: 'PENDIENTE' | 'ACTIVA' | 'VENCIDA' | 'SUSPENDIDA' | 'REVOCADA';
  starts_at: Date | null;
  expires_at: Date | null;
  max_users?: number | null;
}

function assertActiveLicense(
  license: LicenseRow | undefined,
  scope: 'company' | 'user',
): asserts license is LicenseRow {
  if (!license) {
    const msg = scope === 'user'
      ? 'Tu usuario no tiene una licencia asignada.'
      : 'La empresa no tiene una licencia asignada.';
    throw new AppError('LICENSE_EXPIRED', msg, 402);
  }
  if (license.status === 'SUSPENDIDA' || license.status === 'REVOCADA' || license.status === 'PENDIENTE') {
    throw new AppError('LICENSE_EXPIRED', 'La licencia de la empresa o del usuario no está activa.', 402);
  }
  if (license.status === 'VENCIDA' || !license.expires_at || license.expires_at.getTime() <= Date.now()) {
    throw new AppError('LICENSE_EXPIRED', 'La licencia ha vencido. Activa una renovación para continuar.', 402);
  }
  if (!license.starts_at || license.starts_at.getTime() > Date.now()) {
    throw new AppError('LICENSE_EXPIRED', 'La vigencia de la licencia todavía no comienza.', 402);
  }
}

export async function assertLicenseAccess(
  pool: Pool,
  claims: AccessClaims,
  request: { method: string; url: string },
): Promise<void> {
  const path = request.url.split('?')[0];

  if (claims.plat || !claims.cid) return;
  if (path.startsWith('/api/v1/platform/')) return;

  if (
    (request.method === 'GET' && (
      path === '/api/v1/auth/me' ||
      path === '/api/v1/license-status' ||
      path === '/api/v1/licenses/status'
    )) ||
    (request.method === 'POST' && (
      path === '/api/v1/licenses/redeem' ||
      path === '/api/v1/user-licenses/redeem' ||
      path === '/api/v1/licenses/activate'
    ))
  ) return;

  await withContext(pool, { companyId: claims.cid, userId: claims.sub }, async (c) => {
    const companyResult = await c.query<LicenseRow>(
      `SELECT status, starts_at, expires_at, max_users FROM licenses
        WHERE company_id = $1
        ORDER BY CASE WHEN status = 'ACTIVA' AND starts_at <= now() AND expires_at > now() THEN 0
                      WHEN status = 'PENDIENTE' THEN 1 WHEN status = 'ACTIVA' THEN 2 ELSE 3 END,
                 expires_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [claims.cid],
    );
    const companyLicense = companyResult.rows[0];
    assertActiveLicense(companyLicense, 'company');

    const userResult = await c.query<LicenseRow>(
      `SELECT status, starts_at, expires_at FROM user_licenses
        WHERE company_id = $1 AND user_id = $2
        ORDER BY CASE WHEN status = 'ACTIVA' AND starts_at <= now() AND expires_at > now() THEN 0
                      WHEN status = 'PENDIENTE' THEN 1 WHEN status = 'ACTIVA' THEN 2 ELSE 3 END,
                 expires_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [claims.cid, claims.sub],
    );
    assertActiveLicense(userResult.rows[0], 'user');

    const memberCount = await c.query<{ count: number }>(
      `SELECT count(DISTINCT user_id)::int AS count FROM company_users
        WHERE company_id = $1 AND status = 'ACTIVO'`,
      [claims.cid],
    );
    const activeUsers = memberCount.rows[0]?.count ?? 0;
    const maxUsers = Number(companyLicense.max_users ?? 0);
    const isCreatingUser = request.method === 'POST' && path === '/api/v1/users';
    if (isCreatingUser && activeUsers >= maxUsers) {
      throw new AppError('LICENSE_USER_LIMIT_REACHED', 'La empresa alcanzó el cupo de usuarios de su licencia.', 403);
    }
    if (activeUsers > maxUsers) {
      throw new AppError('LICENSE_USER_LIMIT_EXCEEDED', 'La empresa supera el cupo de usuarios de su licencia.', 403);
    }
  });
}
