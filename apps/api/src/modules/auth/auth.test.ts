import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { createPool } from '../../database/client.js';
import { hashPassword } from './password.js';

// Pruebas de extremo a extremo contra una base real. Se omiten si falta configuración
// (el CI sin base de datos sigue en verde).
const enabled = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL && process.env.JWT_ACCESS_SECRET,
);

// Varias de estas pruebas hacen varias idas y vueltas seguidas contra una base remota
// (Neon), que además puede tardar en "despertar" tras estar inactiva. El valor por defecto
// de Vitest (5s) es corto para eso; se amplía solo donde hace falta.
const REMOTE_DB_TIMEOUT_MS = 20_000;

describe.skipIf(!enabled)('Autenticación (FASE 3a)', () => {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
  let admin: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const companyId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const email = `auth-${randomUUID()}@example.test`;
  const password = 'clave-de-prueba-larga-123';
  const registrationEmail = `registro-${randomUUID()}@example.test`;
  const registrationPassword = 'clave-de-registro-larga-123';
  let registrationCompanyId: string | undefined;
  let registrationUserId: string | undefined;

  async function resetAccount(): Promise<void> {
    await admin.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-auth')`, [companyId]);
    await admin.query(`INSERT INTO roles (id, company_id, name) VALUES ($1, $2, 'Admin')`, [roleId, companyId]);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Usuario de prueba')`,
      [userId, email, await hashPassword(password)],
    );
    await admin.query(`INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      companyId, userId, roleId,
    ]);
    await admin.query(
      `INSERT INTO licenses (company_id, key_hash, status, duration_seconds, max_users, starts_at, expires_at, created_by)
       VALUES ($1,$2,'ACTIVA',31536000,5,now(),now() + interval '1 year',$3)`,
      [companyId, `auth-company-${randomUUID()}`, userId],
    );
    await admin.query(
      `INSERT INTO user_licenses (company_id, user_id, key_hash, status, duration_seconds, starts_at, expires_at, created_by)
       VALUES ($1,$2,$3,'ACTIVA',31536000,now(),now() + interval '1 year',$2)`,
      [companyId, userId, `auth-user-${randomUUID()}`],
    );

    const pool = createPool(process.env.DATABASE_URL!);
    app = await buildApp({ env, pool });
  }, REMOTE_DB_TIMEOUT_MS);

  afterAll(async () => {
    if (registrationUserId) {
      await admin.query(`DELETE FROM sessions WHERE user_id = $1`, [registrationUserId]);
    }
    if (registrationCompanyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [registrationCompanyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [registrationCompanyId]);
    }
    if (registrationUserId) {
      await admin.query(`DELETE FROM users WHERE id = $1`, [registrationUserId]);
    }
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

  it('rechaza credenciales incorrectas sin revelar si el correo existe', async () => {
    const withBadPassword = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'incorrecta-pero-larga' },
    });
    const withUnknownEmail = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: `no-existe-${randomUUID()}@example.test`, password: 'cualquiera-larga' },
    });
    expect(withBadPassword.statusCode).toBe(401);
    expect(withUnknownEmail.statusCode).toBe(401);
    expect(withBadPassword.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(withUnknownEmail.json().error.code).toBe('INVALID_CREDENTIALS');
    await resetAccount();
  }, REMOTE_DB_TIMEOUT_MS);

  it('bloquea la cuenta tras varios intentos fallidos', async () => {
    try {
      let last;
      for (let i = 0; i < 5; i++) {
        last = await app.inject({
          method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'mala-clave-larga' },
        });
      }
      expect(last!.statusCode).toBe(423);
      expect(last!.json().error.code).toBe('ACCOUNT_LOCKED');

      const whileLocked = await app.inject({
        method: 'POST', url: '/api/v1/auth/login', payload: { email, password },
      });
      expect(whileLocked.statusCode).toBe(423);
    } finally {
      // Pase o falle la prueba, la cuenta vuelve a quedar usable para las siguientes.
      await resetAccount();
    }
  }, REMOTE_DB_TIMEOUT_MS);

  it('inicia sesión y devuelve un access token que protege rutas', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accessToken).toBeTypeOf('string');
    expect(body.data.user.companyId).toBe(companyId);

    const me = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${body.data.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.companyId).toBe(companyId);
  }, REMOTE_DB_TIMEOUT_MS);

  it('registra una empresa con cuenta administradora y rechaza correos repetidos', async () => {
    const payload = {
      name: 'Empresa de registro',
      fullName: 'Administradora de prueba',
      email: registrationEmail,
      password: registrationPassword,
    };
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload,
    });

    expect(registered.statusCode).toBe(201);
    registrationCompanyId = registered.json().data.company.id;
    expect(registered.json().data.message).toContain('licencias');

    const user = await admin.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [registrationEmail],
    );
    registrationUserId = user.rows[0]?.id;
    expect(registrationUserId).toBeTruthy();

    const membership = await admin.query<{ company_id: string; status: string }>(
      `SELECT company_id, status FROM company_users WHERE user_id = $1`,
      [registrationUserId],
    );
    expect(membership.rows).toEqual([{ company_id: registrationCompanyId, status: 'ACTIVO' }]);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: registrationEmail, password: registrationPassword },
    });
    expect(login.statusCode).toBe(200);
    await admin.query(`DELETE FROM sessions WHERE user_id = $1`, [registrationUserId]);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  }, REMOTE_DB_TIMEOUT_MS);

  it('exige autenticación en rutas protegidas', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rota el refresh token y revoca su reutilización (token robado)', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    const firstRefresh = extractRefreshCookie(login);

    const r1 = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: firstRefresh },
    });
    expect(r1.statusCode).toBe(200);
    const secondRefresh = extractRefreshCookie(r1);
    expect(secondRefresh).not.toBe(firstRefresh);

    // Reutilizar el token viejo (ya usado) debe fallar y revocar toda la familia.
    const reuse = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: firstRefresh },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('SESSION_REUSE_DETECTED');

    // Como se revocó la familia, incluso el token recién emitido queda inválido.
    const afterRevoke = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: secondRefresh },
    });
    expect(afterRevoke.statusCode).toBe(401);
  }, REMOTE_DB_TIMEOUT_MS);

  it('logout revoca la sesión', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    const token = extractRefreshCookie(login);

    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { refresh_token: token } });
    expect(out.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: token },
    });
    expect(afterLogout.statusCode).toBe(401);
  }, REMOTE_DB_TIMEOUT_MS);

  it('cambia la contraseña y cierra las demás sesiones', async () => {
    const loginA = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(loginA.statusCode).toBe(200);
    const tokenA = extractRefreshCookie(loginA);
    const loginB = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(loginB.statusCode).toBe(200);
    const tokenB = extractRefreshCookie(loginB);
    const accessA = loginA.json().data.accessToken;

    const newPassword = 'nueva-clave-de-prueba-456';
    const change = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${accessA}` },
      payload: { currentPassword: password, newPassword },
    });
    expect(change.statusCode).toBe(204);

    // La sesión B (otra sesión del mismo usuario) queda revocada.
    const refreshB = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: tokenB },
    });
    expect(refreshB.statusCode).toBe(401);

    // La sesión A (desde la que se cambió la contraseña) sigue viva.
    const refreshA = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: { refresh_token: tokenA },
    });
    expect(refreshA.statusCode).toBe(200);

    // La nueva contraseña ya funciona para iniciar sesión.
    const loginNew = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: newPassword },
    });
    expect(loginNew.statusCode).toBe(200);

    await admin.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(password)]);
  }, REMOTE_DB_TIMEOUT_MS);
});
