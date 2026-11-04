import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { createPool } from '../../database/client.js';
import { hashPassword } from './password.js';
import { requestPasswordReset } from './service.js';
import { generateTotp } from './totp.js';
import type { AuthContext } from './service.js';

const enabled = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL && process.env.JWT_ACCESS_SECRET,
);

const REMOTE_DB_TIMEOUT_MS = 20_000;

describe.skipIf(!enabled)('Recuperación de contraseña y 2FA (FASE 3b)', () => {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
  let admin: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let authCtx: AuthContext;

  const companyId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const email = `fase3b-${randomUUID()}@example.test`;
  const password = 'clave-de-prueba-larga-123';

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-3b')`, [companyId]);
    await admin.query(`INSERT INTO roles (id, company_id, name) VALUES ($1, $2, 'Admin')`, [roleId, companyId]);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Usuario 3b')`,
      [userId, email, await hashPassword(password)],
    );
    await admin.query(`INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      companyId, userId, roleId,
    ]);
    await admin.query(
      `INSERT INTO licenses (company_id, key_hash, status, duration_seconds, max_users, starts_at, expires_at, created_by)
       VALUES ($1,$2,'ACTIVA',31536000,5,now(),now() + interval '1 year',$3)`,
      [companyId, `auth-3b-company-${randomUUID()}`, userId],
    );
    await admin.query(
      `INSERT INTO user_licenses (company_id, user_id, key_hash, status, duration_seconds, starts_at, expires_at, created_by)
       VALUES ($1,$2,$3,'ACTIVA',31536000,now(),now() + interval '1 year',$2)`,
      [companyId, userId, `auth-3b-user-${randomUUID()}`],
    );

    const pool = createPool(process.env.DATABASE_URL!);
    app = await buildApp({ env, pool });
    // Mismo AuthContext que arma app.ts, reconstruido aquí para llamar a requestPasswordReset
    // directamente: necesitamos el token en texto plano para probar el flujo completo, y la
    // ruta HTTP nunca lo devuelve al cliente (por seguridad), solo lo envía por correo.
    authCtx = {
      pool,
      env,
      signAccessToken: () => {
        throw new Error('no usado en estas pruebas');
      },
    };
  }, REMOTE_DB_TIMEOUT_MS);

  afterAll(async () => {
    await admin.query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);
    await admin.query(`DELETE FROM user_2fa WHERE user_id = $1`, [userId]);
    await admin.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    await admin.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
    await admin.end();
  }, REMOTE_DB_TIMEOUT_MS);

  function extractRefreshCookie(res: { cookies: { name: string; value: string }[] }): string {
    const c = res.cookies.find((x) => x.name === 'refresh_token');
    if (!c) throw new Error('No se recibió la cookie refresh_token');
    return c.value;
  }

  it('la solicitud de recuperación responde igual exista o no el correo', async () => {
    const existing = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email },
    });
    const missing = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password',
      payload: { email: `no-existe-${randomUUID()}@example.test` },
    });
    expect(existing.statusCode).toBe(202);
    expect(missing.statusCode).toBe(202);
    expect(existing.json()).toEqual(missing.json());
  }, REMOTE_DB_TIMEOUT_MS);

  it('rechaza un token inválido al restablecer', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: 'token-que-nunca-existio-en-la-base-de-datos', newPassword: 'otra-clave-larga-789' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_RESET_TOKEN');
  }, REMOTE_DB_TIMEOUT_MS);

  it('restablece la contraseña con un token real, cierra sesiones y el token no sirve dos veces', async () => {
    // Login previo para comprobar que restablecer cierra también esta sesión.
    const priorLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(priorLogin.statusCode).toBe(200);
    const priorRefresh = extractRefreshCookie(priorLogin);

    // requestPasswordReset() genera el token y solo guarda su HASH (no es reversible), y la
    // ruta HTTP nunca devuelve el token en texto plano al cliente (eso iría por correo real).
    // Para probar el camino completo sin depender de un proveedor de correo externo, esta
    // prueba llama al servicio de verdad para confirmar que SÍ crea el registro...
    await requestPasswordReset(authCtx, email);
    const stored = await admin.query(
      'SELECT token_hash FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    );
    expect(stored.rowCount).toBe(1);

    // ...y luego ejercita el endpoint de restablecimiento con un token fabricado de la misma
    // forma (mismo generador y mismo hash) e insertado directamente, ya que el valor en texto
    // plano del primero solo lo conoció el correo que (en pruebas) nunca se envía de verdad.
    const { randomBytes, createHash } = await import('node:crypto');
    const plainToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');
    await admin.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')',
      [userId, tokenHash],
    );

    const newPassword = 'clave-restablecida-999';
    const reset = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: plainToken, newPassword },
    });
    expect(reset.statusCode).toBe(204);

    // La sesión que existía antes del restablecimiento queda revocada.
    const afterReset = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: priorRefresh },
    });
    expect(afterReset.statusCode).toBe(401);

    // El mismo token no sirve una segunda vez.
    const reuse = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: plainToken, newPassword: 'otra-clave-mas-1234' },
    });
    expect(reuse.statusCode).toBe(400);

    // La nueva contraseña ya funciona.
    const loginWithNew = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: newPassword },
    });
    expect(loginWithNew.statusCode).toBe(200);

    // Se deja la contraseña como estaba para no interferir con pruebas futuras del archivo.
    await admin.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(password)]);
  }, REMOTE_DB_TIMEOUT_MS);

  it('configura, confirma y exige 2FA en el login; permite iniciar sesión con el código correcto', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().data.accessToken;

    const setup = await app.inject({
      method: 'POST', url: '/api/v1/auth/2fa/setup',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(setup.statusCode).toBe(200);
    const { secret, recoveryCodes } = setup.json().data as { secret: string; recoveryCodes: string[] };
    expect(secret).toBeTypeOf('string');
    expect(recoveryCodes).toHaveLength(8);

    const confirm = await app.inject({
      method: 'POST', url: '/api/v1/auth/2fa/confirm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code: generateTotp(secret) },
    });
    expect(confirm.statusCode).toBe(204);

    // Ahora el login sin código debe pedir el segundo factor.
    const loginNoCode = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(loginNoCode.statusCode).toBe(401);
    expect(loginNoCode.json().error.code).toBe('TWO_FACTOR_REQUIRED');

    // Con un código equivocado, también falla.
    const loginBadCode = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password, twoFactorCode: '000000' },
    });
    expect(loginBadCode.statusCode).toBe(401);
    expect(loginBadCode.json().error.code).toBe('INVALID_TWO_FACTOR_CODE');

    // Con el código correcto, entra.
    const loginWithCode = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password, twoFactorCode: generateTotp(secret) },
    });
    expect(loginWithCode.statusCode).toBe(200);

    // Un código de recuperación también sirve, una sola vez.
    const recoveryLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password, twoFactorCode: recoveryCodes[0] },
    });
    expect(recoveryLogin.statusCode).toBe(200);
    const recoveryReuse = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password, twoFactorCode: recoveryCodes[0] },
    });
    expect(recoveryReuse.statusCode).toBe(401);

    // Se desactiva el 2FA (con la contraseña) para no afectar otras corridas de este archivo.
    const freshLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password, twoFactorCode: generateTotp(secret) },
    });
    const disable = await app.inject({
      method: 'POST', url: '/api/v1/auth/2fa/disable',
      headers: { authorization: `Bearer ${freshLogin.json().data.accessToken}` },
      payload: { password },
    });
    expect(disable.statusCode).toBe(204);

    const loginAfterDisable = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password },
    });
    expect(loginAfterDisable.statusCode).toBe(200);
  }, REMOTE_DB_TIMEOUT_MS);
});
