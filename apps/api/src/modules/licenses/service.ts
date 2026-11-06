import type { Pool, PoolClient } from 'pg';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { generateActivationCode, hashToken } from '../auth/tokens.js';
import * as repo from './repository.js';

export interface IssuedKey {
  id: string;
  key: string; // código de 6 dígitos en texto plano: se muestra UNA sola vez, nunca se vuelve a poder leer
  durationSeconds: number;
}

/**
 * Genera un código de activación de 6 dígitos que no exista ya en ninguna de
 * las tres tablas de licencias. Con solo un millón de códigos posibles, dos
 * códigos iguales en ámbitos distintos (empresa, usuario, registro) serían
 * ambiguos al canjear, así que la unicidad es global, no por tabla. Solo se
 * guarda su hash; el código en claro lo devuelve esta función para mostrarlo
 * una sola vez al emitirlo.
 */
async function generateUniqueActivationCode(pool: Pool): Promise<{ code: string; keyHash: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateActivationCode();
    const keyHash = hashToken(code);
    const exists = await withContext(pool, { platform: true }, async (c) => {
      const r = await c.query<{ found: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM licenses WHERE key_hash = $1
           UNION ALL SELECT 1 FROM user_licenses WHERE key_hash = $1
           UNION ALL SELECT 1 FROM registration_licenses WHERE key_hash = $1
         ) AS found`,
        [keyHash],
      );
      return r.rows[0]?.found ?? false;
    });
    if (!exists) return { code, keyHash };
  }
  throw new AppError(
    'ACTIVATION_CODE_UNAVAILABLE',
    'No fue posible generar un código de activación. Inténtalo de nuevo.',
    500,
  );
}

// ---------------------------------------------------------------- plataforma: emitir/gestionar

export async function createLicense(
  pool: Pool,
  platformUserId: string,
  input: { companyId: string; durationSeconds: number; maxUsers: number },
): Promise<IssuedKey> {
  const { code: key, keyHash } = await generateUniqueActivationCode(pool);
  const row = await withContext(pool, { companyId: input.companyId, platform: true }, (c) =>
    repo.insertLicense(c, {
      companyId: input.companyId,
      keyHash,
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
  const { code: key, keyHash } = await generateUniqueActivationCode(pool);
  const row = await withContext(pool, { companyId: input.companyId, platform: true }, (c) =>
    repo.insertUserLicense(c, {
      companyId: input.companyId,
      userId: input.userId,
      keyHash,
      durationSeconds: input.durationSeconds,
      createdBy: platformUserId,
    }),
  );
  return { id: row.id, key, durationSeconds: input.durationSeconds };
}

export async function createRegistrationLicense(
  pool: Pool,
  platformUserId: string,
  input: { durationSeconds: number; maxUsers: number },
): Promise<IssuedKey & { maxUsers: number }> {
  const { code: key, keyHash } = await generateUniqueActivationCode(pool);
  const row = await withContext(pool, { platform: true }, (c) =>
    repo.insertRegistrationLicense(c, {
      keyHash,
      durationSeconds: input.durationSeconds,
      maxUsers: input.maxUsers,
      createdBy: platformUserId,
    }),
  );
  return { id: row.id, key, durationSeconds: input.durationSeconds, maxUsers: input.maxUsers };
}

export async function redeemRegistrationLicenseOnClient(
  c: PoolClient,
  ctx: { companyId: string; userId: string },
  key: string,
): Promise<{ registrationLicenseId: string; companyLicenseId: string; userLicenseId: string }> {
  try {
    const r = await c.query<{
      registration_license_id: string;
      company_license_id: string;
      user_license_id: string;
    }>(
      'SELECT * FROM redeem_registration_license($1, $2, $3)',
      [hashToken(key), ctx.companyId, ctx.userId],
    );
    if (r.rowCount !== 1) {
      throw new AppError('INVALID_REGISTRATION_LICENSE', 'El código de registro no es válido.', 400);
    }
    await c.query(
      `INSERT INTO audit_logs (company_id, user_id, action, metadata)
       VALUES ($1, $2, 'licenses.registration_redeemed', $3)`,
      [ctx.companyId, ctx.userId, JSON.stringify({ registrationLicenseId: r.rows[0]!.registration_license_id })],
    );
    return {
      registrationLicenseId: r.rows[0]!.registration_license_id,
      companyLicenseId: r.rows[0]!.company_license_id,
      userLicenseId: r.rows[0]!.user_license_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('REGISTRATION_LICENSE_NOT_FOUND')) {
      throw new AppError('INVALID_REGISTRATION_LICENSE', 'El código de registro no es válido.', 400);
    }
    if (message.includes('REGISTRATION_LICENSE_NOT_REDEEMABLE')) {
      throw new AppError('REGISTRATION_LICENSE_NOT_REDEEMABLE', 'El código de registro ya fue utilizado o revocado.', 409);
    }
    throw error;
  }
}

/**
 * Canjea un código de registro en una empresa que ya existe: activa a la vez la
 * licencia de empresa y la del usuario. La función SQL exige contexto de
 * plataforma, así que se ejecuta con platform: true (el código en sí es la
 * autorización: es de un solo uso y solo la emite el superadministrador).
 */
export async function activateRegistrationLicense(
  pool: Pool,
  ctx: { userId: string; companyId: string },
  key: string,
): Promise<{ scope: 'both'; status: 'ACTIVA'; startsAt: Date; expiresAt: Date }> {
  const ids = await withContext(pool, { platform: true, companyId: ctx.companyId, userId: ctx.userId }, (c) =>
    redeemRegistrationLicenseOnClient(c, ctx, key),
  );
  const companyLicense = await withContext(pool, { platform: true, companyId: ctx.companyId }, (c) =>
    repo.getLicense(c, ids.companyLicenseId),
  );
  if (!companyLicense?.starts_at || !companyLicense.expires_at) {
    throw new AppError('INTERNAL_ERROR', 'El código de registro se canjeó, pero no se pudo leer la licencia creada.', 500);
  }
  return {
    scope: 'both',
    status: 'ACTIVA',
    startsAt: companyLicense.starts_at,
    expiresAt: companyLicense.expires_at,
  };
}

export async function listCompanyLicenses(pool: Pool, companyId: string): Promise<repo.LicenseRow[]> {
  return withContext(pool, { companyId, platform: true }, (c) => repo.listLicenses(c, companyId));
}

export async function listUserLicenses(
  pool: Pool,
  companyId: string,
  userId: string,
): Promise<repo.UserLicenseRow[]> {
  return withContext(pool, { companyId, platform: true }, (c) => repo.listUserLicenses(c, companyId, userId));
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

export async function setUserLicenseStatus(
  pool: Pool,
  licenseId: string,
  status: 'SUSPENDIDA' | 'REVOCADA' | 'ACTIVA',
): Promise<repo.UserLicenseRow> {
  return withContext(pool, { platform: true }, async (c) => {
    const license = await repo.getUserLicense(c, licenseId);
    if (!license) {
      throw new AppError('USER_LICENSE_NOT_FOUND', 'La licencia de usuario indicada no existe.', 404);
    }
    await repo.setUserLicenseStatus(c, licenseId, status);
    await c.query(
      `INSERT INTO audit_logs (company_id, action, metadata) VALUES ($1, 'user_licenses.status_change', $2)`,
      [license.company_id, JSON.stringify({ userLicenseId: licenseId, status })],
    );
    return (await repo.getUserLicense(c, licenseId))!;
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
    throw new AppError('INVALID_LICENSE_KEY', 'El código no es válido para esta empresa.', 400);
  }
  if (outcome.kind === 'not_redeemable') {
    throw new AppError('LICENSE_NOT_REDEEMABLE', 'Ese código ya fue usado, está revocado o ya no aplica.', 409);
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
    throw new AppError('INVALID_LICENSE_KEY', 'El código no es válido para tu usuario en esta empresa.', 400);
  }
  if (outcome.kind === 'not_redeemable') {
    throw new AppError('LICENSE_NOT_REDEEMABLE', 'Ese código ya fue usado, está revocado o ya no aplica.', 409);
  }
  return outcome.row;
}

export async function activateLicense(
  pool: Pool,
  ctx: { userId: string; companyId: string },
  key: string,
): Promise<{ scope: 'company' | 'user' | 'both'; status: 'ACTIVA'; startsAt: Date; expiresAt: Date }> {
  try {
    const license = await redeemCompanyLicense(pool, ctx, key);
    return {
      scope: 'company',
      status: 'ACTIVA',
      startsAt: license.starts_at!,
      expiresAt: license.expires_at!,
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'INVALID_LICENSE_KEY') throw error;
  }

  try {
    const license = await redeemUserLicense(pool, ctx, key);
    return {
      scope: 'user',
      status: 'ACTIVA',
      startsAt: license.starts_at!,
      expiresAt: license.expires_at!,
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'INVALID_LICENSE_KEY') throw error;
  }

  // Un código de registro también vale aquí: activa las dos licencias a la vez.
  // Si tampoco es ese, el código simplemente no existe para esta empresa/usuario.
  try {
    return await activateRegistrationLicense(pool, ctx, key);
  } catch (error) {
    if (error instanceof AppError && error.code === 'REGISTRATION_LICENSE_NOT_REDEEMABLE') throw error;
    throw new AppError('INVALID_LICENSE_KEY', 'El código no es válido para esta empresa.', 400);
  }
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
