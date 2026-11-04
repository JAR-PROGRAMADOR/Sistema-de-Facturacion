import type { Pool, PoolClient } from 'pg';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { generateRefreshToken, hashToken } from '../auth/tokens.js';
import * as repo from './repository.js';

export interface IssuedKey {
  id: string;
  key: string; // en texto plano: se muestra UNA sola vez, nunca se vuelve a poder leer
  durationSeconds: number;
}

// ---------------------------------------------------------------- plataforma: emitir/gestionar

export async function createLicense(
  pool: Pool,
  platformUserId: string,
  input: { companyId: string; durationSeconds: number; maxUsers: number },
): Promise<IssuedKey> {
  const key = generateRefreshToken(); // 256 bits, igual que un refresh token: sobra entropía
  const row = await withContext(pool, { companyId: input.companyId, platform: true }, (c) =>
    repo.insertLicense(c, {
      companyId: input.companyId,
      keyHash: hashToken(key),
      durationSeconds: input.durationSeconds,
      maxUsers: input.maxUsers,
      createdBy: platformUserId,
    }),
  );
  return { id: row.id, key, durationSeconds: input.durationSeconds };
}

export async function createUserLicense(
  pool: Pool,
  platformUserId: string,
  input: { companyId: string; userId: string; durationSeconds: number },
): Promise<IssuedKey> {
  const key = generateRefreshToken();
  const row = await withContext(pool, { companyId: input.companyId, platform: true }, (c) =>
    repo.insertUserLicense(c, {
      companyId: input.companyId,
      userId: input.userId,
      keyHash: hashToken(key),
      durationSeconds: input.durationSeconds,
      createdBy: platformUserId,
    }),
  );
  return { id: row.id, key, durationSeconds: input.durationSeconds };
}

export async function listCompanyLicenses(pool: Pool, companyId: string): Promise<repo.LicenseRow[]> {
  return withContext(pool, { companyId, platform: true }, (c) => repo.listLicenses(c, companyId));
}

export async function setLicenseStatus(
  pool: Pool,
  licenseId: string,
  status: 'SUSPENDIDA' | 'REVOCADA' | 'ACTIVA',
): Promise<repo.LicenseRow> {
  return withContext(pool, { platform: true }, async (c) => {
    const license = await repo.getLicense(c, licenseId);
    if (!license) {
      throw new AppError('LICENSE_NOT_FOUND', 'La licencia indicada no existe.', 404);
    }
    await repo.setLicenseStatus(c, licenseId, status);
    await c.query(
      `INSERT INTO audit_logs (company_id, action, metadata) VALUES ($1, 'licenses.status_change', $2)`,
      [license.company_id, JSON.stringify({ licenseId, status })],
    );
    return (await repo.getLicense(c, licenseId))!;
  });
}

// ---------------------------------------------------------------- empresa: canjear y consultar

type RedeemOutcome = { kind: 'ok'; row: repo.LicenseRow } | { kind: 'not_found' } | { kind: 'not_redeemable' };

export async function redeemCompanyLicense(
  pool: Pool,
  ctx: { userId: string; companyId: string },
  key: string,
): Promise<repo.LicenseRow> {
  const outcome: RedeemOutcome = await withContext(pool, { userId: ctx.userId, companyId: ctx.companyId }, async (c) => {
    try {
      const r = await c.query<{ id: string; status: string; starts_at: Date; expires_at: Date }>(
        'SELECT * FROM redeem_license($1, $2)',
        [ctx.companyId, hashToken(key)],
      );
      if (r.rowCount === 0) return { kind: 'not_found' };
      await c.query(
        `INSERT INTO audit_logs (company_id, user_id, action, metadata) VALUES ($1, $2, 'licenses.redeemed', $3)`,
        [ctx.companyId, ctx.userId, JSON.stringify({ licenseId: r.rows[0]!.id })],
      );
      const full = await repo.getLicense(c, r.rows[0]!.id);
      return { kind: 'ok', row: full! };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('LICENSE_NOT_REDEEMABLE')) return { kind: 'not_redeemable' };
      return { kind: 'not_found' };
    }
  });

  if (outcome.kind === 'not_found') {
    throw new AppError('INVALID_LICENSE_KEY', 'La clave no es válida para esta empresa.', 400);
  }
  if (outcome.kind === 'not_redeemable') {
    throw new AppError('LICENSE_NOT_REDEEMABLE', 'Esa clave ya fue usada, está revocada o ya no aplica.', 409);
  }
  return outcome.row;
}

export async function redeemUserLicense(
  pool: Pool,
  ctx: { userId: string; companyId: string },
  key: string,
): Promise<repo.UserLicenseRow> {
  const outcome = await withContext(pool, { userId: ctx.userId, companyId: ctx.companyId }, async (c) => {
    try {
      const r = await c.query<{ id: string }>(
        'SELECT * FROM redeem_user_license($1, $2, $3)',
        [ctx.companyId, ctx.userId, hashToken(key)],
      );
      if (r.rowCount === 0) return { kind: 'not_found' as const };
      await c.query(
        `INSERT INTO audit_logs (company_id, user_id, action, metadata) VALUES ($1, $2, 'user_licenses.redeemed', $3)`,
        [ctx.companyId, ctx.userId, JSON.stringify({ userLicenseId: r.rows[0]!.id })],
      );
      const list = await repo.listUserLicenses(c, ctx.companyId, ctx.userId);
      return { kind: 'ok' as const, row: list.find((l) => l.id === r.rows[0]!.id)! };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('LICENSE_NOT_REDEEMABLE')) return { kind: 'not_redeemable' as const };
      return { kind: 'not_found' as const };
    }
  });

  if (outcome.kind === 'not_found') {
    throw new AppError('INVALID_LICENSE_KEY', 'La clave no es válida para tu usuario en esta empresa.', 400);
  }
  if (outcome.kind === 'not_redeemable') {
    throw new AppError('LICENSE_NOT_REDEEMABLE', 'Esa clave ya fue usada, está revocada o ya no aplica.', 409);
  }
  return outcome.row;
}

export interface LicenseStatusSummary {
  company: { active: boolean };
  user: { active: boolean; required: boolean };
}

/** Para pantallas de "activa tu licencia": NO exige licencia activa para consultarse a sí misma. */
export async function getLicenseStatus(
  pool: Pool,
  ctx: { userId: string; companyId: string | null; platform: boolean },
): Promise<LicenseStatusSummary> {
  if (ctx.platform || !ctx.companyId) {
    return { company: { active: true }, user: { active: true, required: false } };
  }
  return withContext(pool, { userId: ctx.userId, companyId: ctx.companyId }, async (c) => {
    const companyActive = await repo.hasActiveLicense(c, ctx.companyId!);
    const userActive = await repo.hasActiveUserLicense(c, ctx.companyId!, ctx.userId);
    return { company: { active: companyActive }, user: { active: userActive, required: true } };
  });
}

/**
 * Usada por el middleware de autorización: true solo si TANTO la empresa como el usuario
 * tienen una licencia ACTIVA y vigente. Decisión FASE 0: licencia vencida = bloqueo total.
 */
export async function hasFullyActiveLicense(c: PoolClient, companyId: string, userId: string): Promise<boolean> {
  const companyActive = await repo.hasActiveLicense(c, companyId);
  if (!companyActive) return false;
  return repo.hasActiveUserLicense(c, companyId, userId);
}
