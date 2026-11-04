import type { Pool, PoolClient } from 'pg';
import { withContext, applyContext } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import { dummyVerify, hashPassword, verifyPassword } from './password.js';
import { generateRefreshToken, hashToken } from './tokens.js';
import { generateRecoveryCodes, generateTotpSecret, verifyTotp, buildOtpAuthUrl } from './totp.js';
import * as repo from './repository.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface AuthContext {
  pool: Pool;
  env: Env;
  signAccessToken: (claims: { sub: string; cid: string | null; plat: boolean; fam: string }) => string;
}

export interface SessionInfo {
  userId: string;
  companyId: string | null;
  platform: boolean;
  fullName: string;
  locale: string;
  memberships: repo.Membership[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  session: SessionInfo;
}

function assertAccountUsable(user: repo.UserAuthRow): void {
  if (user.status !== 'ACTIVO') {
    throw new AppError('ACCOUNT_DISABLED', 'Esta cuenta está desactivada. Contacta a tu administrador.', 403);
  }
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    throw new AppError(
      'ACCOUNT_LOCKED',
      'Tu cuenta está bloqueada temporalmente por varios intentos fallidos. Inténtalo más tarde.',
      423,
    );
  }
}

type LoginOutcome =
  | { kind: 'ok'; tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date }; session: SessionInfo }
  | { kind: 'invalid_password'; locked: boolean }
  | { kind: 'two_factor_required' }
  | { kind: 'invalid_two_factor' };

/**
 * Login en varios pasos:
 *   1. Credenciales (correo + contraseña).
 *   2. Si la cuenta tiene 2FA habilitado, un código TOTP o de recuperación.
 *   3. Si el usuario pertenece a más de una empresa, cuál de ellas.
 * Cada paso que falta se informa con un código de error específico para que el cliente
 * pida exactamente lo que falta, sin repetir los pasos ya superados.
 *
 * REGLA QUE SE APRENDIÓ EN LA FASE 3a Y SE RESPETA EN TODA ESTA FUNCIÓN: ninguna rama que
 * necesite guardar algo (intento fallido, consumo de un código de recuperación, etc.) lanza
 * su AppError dentro de la transacción. Siempre devuelve un resultado y dentro de la
 * transacción, y el AppError se lanza recién afuera, una vez que la transacción ya hizo
 * COMMIT. Lanzar un error dentro de la transacción la revierte entera (incluidos los
 * guardados que se querían conservar), que fue exactamente el defecto que costó varias
 * rondas de depuración en la fase anterior.
 */
export async function login(
  ctx: AuthContext,
  input: { email: string; password: string; companyId?: string | undefined; twoFactorCode?: string | undefined },
  meta: { ip: string | null; userAgent: string | null },
): Promise<AuthTokens> {
  const outcome: LoginOutcome = await withContext(ctx.pool, {}, async (c) => {
    const user = await repo.getUserByEmailForUpdate(c, input.email);

    if (!user) {
      await dummyVerify(input.password);
      throw new AppError('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.', 401);
    }

    // Se conoce al usuario: se fija su id en el contexto de inmediato. Las políticas RLS de
    // `users` exigen que el id de la fila coincida con el usuario del contexto para poder
    // actualizarla, y eso aplica incluso antes de saber la empresa.
    await applyContext(c, { userId: user.id });

    // Nada se ha escrito todavía: lanzar aquí es seguro, el ROLLBACK solo descarta lecturas.
    assertAccountUsable(user);

    const valid = await verifyPassword(user.password_hash, input.password);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await repo.recordFailedLogin(c, user.id, attempts, lockedUntil);
      await repo.insertAudit(c, {
        userId: user.id,
        action: 'auth.login',
        result: 'ERROR',
        ip: meta.ip,
        metadata: { reason: 'INVALID_PASSWORD', attempts },
      });
      return { kind: 'invalid_password', locked: Boolean(lockedUntil) };
    }

    // Contraseña correcta: si la cuenta tiene 2FA, hace falta el código antes de continuar.
    const twoFa = await repo.getUser2fa(c, user.id);
    if (twoFa?.enabled) {
      if (!input.twoFactorCode) {
        return { kind: 'two_factor_required' };
      }
      const code = input.twoFactorCode.trim().toUpperCase();
      if (/^\d{6}$/.test(code) && verifyTotp(twoFa.secret, code)) {
        // código TOTP válido, continúa
      } else {
        const codeHash = hashToken(code);
        if (twoFa.recovery_codes_hash.includes(codeHash)) {
          // Un código de recuperación se consume al usarlo (un solo uso). Esto SÍ es una
          // escritura, pero en esta rama el flujo sigue hacia un login exitoso que termina
          // en un `return` normal más abajo, así que la transacción comete bien.
          await repo.consumeRecoveryCode(c, user.id, codeHash);
          await repo.insertAudit(c, { userId: user.id, action: 'auth.2fa_recovery_code_used', ip: meta.ip });
        } else {
          return { kind: 'invalid_two_factor' };
        }
      }
    }

    const memberships = user.is_platform_admin ? [] : await repo.listMemberships(c, user.id);

    let companyId: string | null = null;
    if (!user.is_platform_admin) {
      if (memberships.length === 0) {
        throw new AppError(
          'NO_ACTIVE_COMPANY',
          'Tu usuario no pertenece a ninguna empresa activa. Contacta a tu administrador.',
          403,
        );
      }
      if (memberships.length === 1) {
        companyId = memberships[0]!.company_id;
      } else if (input.companyId) {
        const found = memberships.find((m) => m.company_id === input.companyId);
        if (!found) {
          throw new AppError('COMPANY_NOT_ALLOWED', 'No perteneces a la empresa indicada.', 403);
        }
        companyId = found.company_id;
      } else {
        throw new AppError('COMPANY_SELECTION_REQUIRED', 'Selecciona la empresa con la que deseas ingresar.', 409, {
          companies: memberships.map((m) => ({ id: m.company_id, name: m.company_name })),
        });
      }
    }

    await applyContext(c, { companyId: companyId ?? undefined, userId: user.id, platform: user.is_platform_admin });

    await repo.recordSuccessfulLogin(c, user.id);
    await repo.insertAudit(c, { companyId, userId: user.id, action: 'auth.login', ip: meta.ip });

    const tokens = await issueSession(ctx, c, {
      userId: user.id,
      companyId,
      platform: user.is_platform_admin,
      familyId: crypto.randomUUID(),
      familyStartedAt: new Date(),
      meta,
    });

    return {
      kind: 'ok',
      tokens,
      session: {
        userId: user.id,
        companyId,
        platform: user.is_platform_admin,
        fullName: user.full_name,
        locale: user.locale,
        memberships,
      },
    };
  });

  switch (outcome.kind) {
    case 'ok':
      return { ...outcome.tokens, session: outcome.session };
    case 'invalid_password':
      if (outcome.locked) {
        throw new AppError(
          'ACCOUNT_LOCKED',
          'Tu cuenta está bloqueada temporalmente por varios intentos fallidos. Inténtalo más tarde.',
          423,
        );
      }
      throw new AppError('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.', 401);
    case 'two_factor_required':
      throw new AppError(
        'TWO_FACTOR_REQUIRED',
        'Esta cuenta tiene verificación en dos pasos. Ingresa el código de tu aplicación de autenticación.',
        401,
      );
    case 'invalid_two_factor':
      throw new AppError('INVALID_TWO_FACTOR_CODE', 'El código de verificación no es válido.', 401);
  }
}

async function issueSession(
  ctx: AuthContext,
  c: PoolClient,
  p: {
    userId: string;
    companyId: string | null;
    platform: boolean;
    familyId: string;
    familyStartedAt: Date;
    meta: { ip: string | null; userAgent: string | null };
  },
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await repo.insertSession(c, {
    familyId: p.familyId,
    userId: p.userId,
    companyId: p.companyId,
    tokenHash: hashToken(refreshToken),
    familyStartedAt: p.familyStartedAt,
    expiresAt: refreshExpiresAt,
    userAgent: p.meta.userAgent,
    ip: p.meta.ip,
  });

  const accessToken = ctx.signAccessToken({
    sub: p.userId,
    cid: p.companyId,
    plat: p.platform,
    fam: p.familyId,
  });

  return { accessToken, refreshToken, refreshExpiresAt };
}

type RefreshOutcome =
  | { kind: 'ok'; tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date }; session: SessionInfo }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'reuse' };

export async function refresh(
  ctx: AuthContext,
  refreshToken: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<AuthTokens> {
  const outcome: RefreshOutcome = await withContext(ctx.pool, {}, async (c) => {
    const tokenHash = hashToken(refreshToken);
    const session = await repo.findSessionForUpdate(c, tokenHash);

    if (!session) {
      return { kind: 'invalid' };
    }
    if (session.revoked_at || session.expires_at.getTime() < Date.now()) {
      return { kind: 'expired' };
    }

    await applyContext(c, { companyId: session.company_id ?? undefined, userId: session.user_id });

    if (session.used_at) {
      await repo.revokeFamily(c, session.family_id);
      await repo.insertAudit(c, {
        companyId: session.company_id,
        userId: session.user_id,
        action: 'auth.refresh_reuse_detected',
        result: 'ERROR',
        ip: meta.ip,
      });
      return { kind: 'reuse' };
    }
    const sessionAgeDays = (Date.now() - session.family_started_at.getTime()) / 86_400_000;
    if (sessionAgeDays > ctx.env.SESSION_MAX_DAYS) {
      await repo.revokeFamily(c, session.family_id);
      return { kind: 'expired' };
    }

    const user = await repo.getUserById(c, session.user_id);
    if (!user) {
      return { kind: 'invalid' };
    }
    assertAccountUsable(user);

    await repo.markSessionUsed(c, session.id);

    const tokens = await issueSession(ctx, c, {
      userId: session.user_id,
      companyId: session.company_id,
      platform: user.is_platform_admin,
      familyId: session.family_id,
      familyStartedAt: session.family_started_at,
      meta,
    });

    const memberships = user.is_platform_admin ? [] : await repo.listMemberships(c, user.id);

    return {
      kind: 'ok',
      tokens,
      session: {
        userId: session.user_id,
        companyId: session.company_id,
        platform: user.is_platform_admin,
        fullName: user.full_name,
        locale: user.locale,
        memberships,
      },
    };
  });

  switch (outcome.kind) {
    case 'ok':
      return { ...outcome.tokens, session: outcome.session };
    case 'reuse':
      throw new AppError(
        'SESSION_REUSE_DETECTED',
        'Se detectó un uso indebido de tu sesión. Por seguridad, inicia sesión nuevamente.',
        401,
      );
    case 'expired':
      throw new AppError('SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión nuevamente.', 401);
    case 'invalid':
    default:
      throw new AppError('INVALID_SESSION', 'Tu sesión no es válida. Inicia sesión nuevamente.', 401);
  }
}

export async function logout(ctx: AuthContext, refreshToken: string): Promise<void> {
  await withContext(ctx.pool, {}, async (c) => {
    const session = await repo.findSessionForUpdate(c, hashToken(refreshToken));
    if (session && !session.revoked_at) {
      await applyContext(c, { companyId: session.company_id ?? undefined, userId: session.user_id });
      await repo.revokeFamily(c, session.family_id);
      await repo.insertAudit(c, {
        companyId: session.company_id,
        userId: session.user_id,
        action: 'auth.logout',
      });
    }
  });
}

export async function changePassword(
  ctx: AuthContext,
  authUser: { userId: string; companyId: string | null; platform: boolean },
  input: { currentPassword: string; newPassword: string },
  currentFamilyId: string,
): Promise<void> {
  await withContext(
    ctx.pool,
    { userId: authUser.userId, companyId: authUser.companyId ?? undefined, platform: authUser.platform },
    async (c) => {
      const user = await repo.getUserById(c, authUser.userId);
      if (!user) {
        throw new AppError('UNAUTHENTICATED', 'Tu sesión no es válida. Inicia sesión nuevamente.', 401);
      }
      const valid = await verifyPassword(user.password_hash, input.currentPassword);
      if (!valid) {
        throw new AppError('INVALID_CREDENTIALS', 'La contraseña actual no es correcta.', 401);
      }
      const newHash = await hashPassword(input.newPassword);
      await repo.updatePassword(c, user.id, newHash);
      await repo.revokeUserSessions(c, user.id, currentFamilyId);
      await repo.insertAudit(c, { companyId: authUser.companyId, userId: user.id, action: 'auth.change_password' });
    },
  );
}

export async function getCompanyProfile(ctx: AuthContext, companyId: string) {
  return withContext(ctx.pool, { companyId, platform: true }, (c) => repo.getCompany(c, companyId));
}

/** Correo del usuario autenticado, para mostrarlo en el código QR del 2FA. */
export async function getAccountEmail(
  ctx: AuthContext,
  authUser: { userId: string; companyId: string | null; platform: boolean },
): Promise<string> {
  const user = await withContext(
    ctx.pool,
    { userId: authUser.userId, companyId: authUser.companyId ?? undefined, platform: authUser.platform },
    (c) => repo.getUserById(c, authUser.userId),
  );
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Tu sesión no es válida. Inicia sesión nuevamente.', 401);
  }
  return user.email;
}

// ---------------------------------------------------------------- FASE 3b: recuperación

interface ResetRequestOutcome {
  shouldSend: boolean;
  email?: string;
  fullName?: string;
  token?: string;
}

/**
 * Solicita la recuperación de contraseña. SIEMPRE responde de forma genérica al cliente
 * (no revela si el correo existe), por eso esta función no lanza error por "usuario no
 * encontrado": simplemente no genera token ni envía correo en ese caso.
 * El envío del correo ocurre DESPUÉS de que la transacción de base de datos ya hizo COMMIT
 * (nunca dentro de ella): una llamada de red no debe mantener abierta una transacción, y si
 * Resend tarda o falla, no debe arrastrar con ella el token que ya se guardó.
 */
export async function requestPasswordReset(
  ctx: AuthContext,
  email: string,
): Promise<void> {
  const token = generateRefreshToken(); // mismo generador: 256 bits, opaco, URL-safe
  const outcome: ResetRequestOutcome = await withContext(ctx.pool, {}, async (c) => {
    const user = await repo.getUserByEmail(c, email);
    if (!user || user.status !== 'ACTIVO') {
      return { shouldSend: false };
    }
    await applyContext(c, { userId: user.id });

    const expiresAt = new Date(Date.now() + ctx.env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    await repo.insertPasswordReset(c, { userId: user.id, tokenHash: hashToken(token), expiresAt });
    await repo.insertAudit(c, { userId: user.id, action: 'auth.password_reset_requested' });

    return { shouldSend: true, email: user.email, fullName: user.full_name, token };
  });

  if (outcome.shouldSend && outcome.email) {
    const resetUrl = `${ctx.env.FRONTEND_URL.replace(/\/$/, '')}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
    const { sendPasswordResetEmail } = await import('./email.js');
    // Un fallo al enviar el correo no debe delatar si el usuario existe ni romper la
    // respuesta genérica; queda registrado para que el equipo lo note.
    try {
      await sendPasswordResetEmail(ctx.env, outcome.email, resetUrl);
    } catch (err) {
      console.error('No se pudo enviar el correo de recuperación de contraseña:', err);
    }
  }
}

type ResetPasswordOutcome = { kind: 'ok' } | { kind: 'invalid' };

export async function resetPassword(ctx: AuthContext, token: string, newPassword: string): Promise<void> {
  const outcome: ResetPasswordOutcome = await withContext(ctx.pool, {}, async (c) => {
    const row = await repo.findPasswordResetForUpdate(c, hashToken(token));
    if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
      return { kind: 'invalid' };
    }

    await applyContext(c, { userId: row.user_id });
    const user = await repo.getUserById(c, row.user_id);
    if (!user) {
      return { kind: 'invalid' };
    }

    const newHash = await hashPassword(newPassword);
    await repo.updatePassword(c, user.id, newHash);
    await repo.markPasswordResetUsed(c, row.id);
    // Un restablecimiento de contraseña cierra TODAS las sesiones, sin excepción: a
    // diferencia de un cambio de contraseña normal, quien lo hace puede no ser quien tenía
    // las sesiones abiertas (por eso existía la necesidad de recuperarla).
    await repo.revokeUserSessions(c, user.id, null);
    await repo.insertAudit(c, { userId: user.id, action: 'auth.password_reset_completed' });

    return { kind: 'ok' };
  });

  if (outcome.kind === 'invalid') {
    throw new AppError(
      'INVALID_RESET_TOKEN',
      'El enlace no es válido o ya expiró. Solicita uno nuevo.',
      400,
    );
  }
}

// ---------------------------------------------------------------- FASE 3b: 2FA

export interface TwoFactorSetup {
  secret: string;
  otpAuthUrl: string;
  recoveryCodes: string[];
}

/**
 * Genera un secreto nuevo y códigos de recuperación, PERO no habilita el 2FA todavía: queda
 * "pendiente" hasta que el usuario confirme con un código real desde su aplicación de
 * autenticación (confirmTwoFactor). Esto evita que alguien quede bloqueado de su propia
 * cuenta por haber escaneado mal el código QR.
 */
export async function setupTwoFactor(
  ctx: AuthContext,
  authUser: { userId: string; companyId: string | null; platform: boolean },
  accountEmail: string,
): Promise<TwoFactorSetup> {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodesHash = recoveryCodes.map((code) => hashToken(code));

  await withContext(
    ctx.pool,
    { userId: authUser.userId, companyId: authUser.companyId ?? undefined, platform: authUser.platform },
    async (c) => {
      await repo.upsertPendingUser2fa(c, { userId: authUser.userId, secret, recoveryCodesHash });
      await repo.insertAudit(c, {
        companyId: authUser.companyId,
        userId: authUser.userId,
        action: 'auth.2fa_setup_started',
      });
    },
  );

  return {
    secret,
    otpAuthUrl: buildOtpAuthUrl(secret, accountEmail, ctx.env.TWO_FACTOR_ISSUER),
    recoveryCodes,
  };
}

type ConfirmTwoFactorOutcome = { kind: 'ok' } | { kind: 'invalid_code' } | { kind: 'not_pending' };

export async function confirmTwoFactor(
  ctx: AuthContext,
  authUser: { userId: string; companyId: string | null; platform: boolean },
  code: string,
): Promise<void> {
  const outcome: ConfirmTwoFactorOutcome = await withContext(
    ctx.pool,
    { userId: authUser.userId, companyId: authUser.companyId ?? undefined, platform: authUser.platform },
    async (c) => {
      const twoFa = await repo.getUser2fa(c, authUser.userId);
      if (!twoFa || twoFa.enabled) {
        return { kind: 'not_pending' };
      }
      if (!verifyTotp(twoFa.secret, code)) {
        return { kind: 'invalid_code' };
      }
      await repo.enableUser2fa(c, authUser.userId);
      await repo.insertAudit(c, {
        companyId: authUser.companyId,
        userId: authUser.userId,
        action: 'auth.2fa_enabled',
      });
      return { kind: 'ok' };
    },
  );

  if (outcome.kind === 'not_pending') {
    throw new AppError(
      'TWO_FACTOR_NOT_PENDING',
      'No hay una configuración de verificación en dos pasos pendiente de confirmar. Empieza de nuevo desde el paso de configuración.',
      409,
    );
  }
  if (outcome.kind === 'invalid_code') {
    throw new AppError('INVALID_TWO_FACTOR_CODE', 'El código de verificación no es válido.', 401);
  }
}

export async function disableTwoFactor(
  ctx: AuthContext,
  authUser: { userId: string; companyId: string | null; platform: boolean },
  currentPassword: string,
): Promise<void> {
  await withContext(
    ctx.pool,
    { userId: authUser.userId, companyId: authUser.companyId ?? undefined, platform: authUser.platform },
    async (c) => {
      const user = await repo.getUserById(c, authUser.userId);
      if (!user) {
        throw new AppError('UNAUTHENTICATED', 'Tu sesión no es válida. Inicia sesión nuevamente.', 401);
      }
      const valid = await verifyPassword(user.password_hash, currentPassword);
      if (!valid) {
        throw new AppError('INVALID_CREDENTIALS', 'La contraseña no es correcta.', 401);
      }
      await repo.disableUser2fa(c, authUser.userId);
      await repo.insertAudit(c, {
        companyId: authUser.companyId,
        userId: authUser.userId,
        action: 'auth.2fa_disabled',
      });
    },
  );
}

/** Reexportado para que las rutas puedan fijar contexto en consultas puntuales si lo necesitan. */
export { applyContext };
