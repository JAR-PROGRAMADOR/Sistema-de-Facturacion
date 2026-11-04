import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { createPool } from '../../database/client.js';
import { hashPassword } from '../auth/password.js';

const enabled = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL && process.env.JWT_ACCESS_SECRET,
);

const REMOTE_DB_TIMEOUT_MS = 20_000;

describe.skipIf(!enabled)('Licencias (FASE 5)', () => {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
  let admin: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const platformUserId = randomUUID();
  const platformEmail = `platform-lic-${randomUUID()}@example.test`;
  const platformPassword = 'clave-superadmin-larga-123';
  let platformToken: string;

  const companyId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const userEmail = `lic-user-${randomUUID()}@example.test`;
  const userPassword = 'clave-usuario-larga-456';
  let userToken: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, is_platform_admin) VALUES ($1, $2, $3, 'Superadmin', true)`,
      [platformUserId, platformEmail, await hashPassword(platformPassword)],
    );
    await admin.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-licencias')`, [companyId]);
    await admin.query(`INSERT INTO roles (id, company_id, name) VALUES ($1, $2, 'Admin')`, [roleId, companyId]);
    await admin.query(
      `INSERT INTO role_permissions (company_id, role_id, permission_code) VALUES ($1, $2, 'reports.view'), ($1, $2, 'roles.view')`,
      [companyId, roleId],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Usuario de prueba')`,
      [userId, userEmail, await hashPassword(userPassword)],
    );
    await admin.query(`INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [companyId, userId, roleId]);

    const pool = createPool(process.env.DATABASE_URL!);
    app = await buildApp({ env, pool });

    const platformLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: platformEmail, password: platformPassword } });
    platformToken = platformLogin.json().data.accessToken;
    const userLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: userEmail, password: userPassword } });
    userToken = userLogin.json().data.accessToken;
  }, REMOTE_DB_TIMEOUT_MS);

  afterAll(async () => {
    await admin.query(`DELETE FROM user_licenses WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM licenses WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM sessions WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM company_users WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM role_permissions WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
    await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[platformUserId, userId]]);
    await app.close();
    await admin.end();
  }, REMOTE_DB_TIMEOUT_MS);

  it('una clave inválida se rechaza', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key: 'una-clave-que-nunca-existio-en-la-base-de-datos-xyz' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_LICENSE_KEY');
  }, REMOTE_DB_TIMEOUT_MS);

  it('solo el superadministrador puede emitir claves', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/platform/licenses',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { companyId, durationSeconds: 3600, maxUsers: 5 },
    });
    expect(res.statusCode).toBe(403);
  }, REMOTE_DB_TIMEOUT_MS);

  it('emitir, canjear y que la misma clave no sirva una segunda vez', async () => {
    const issue = await app.inject({
      method: 'POST', url: '/api/v1/platform/licenses',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { companyId, durationSeconds: 3600, maxUsers: 5 },
    });
    expect(issue.statusCode).toBe(201);
    const key = issue.json().data.key as string;
    expect(typeof key).toBe('string');

    const first = await app.inject({
      method: 'POST', url: '/api/v1/licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.status).toBe('ACTIVA');

    const second = await app.inject({
      method: 'POST', url: '/api/v1/licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('LICENSE_NOT_REDEEMABLE');
  }, REMOTE_DB_TIMEOUT_MS);

  it('con licencia de empresa pero sin licencia de usuario, sigue bloqueado (402)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('LICENSE_EXPIRED');
  }, REMOTE_DB_TIMEOUT_MS);

  it('al canjear también la licencia de usuario, el acceso se habilita', async () => {
    const issue = await app.inject({
      method: 'POST', url: '/api/v1/platform/user-licenses',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { companyId, userId, durationSeconds: 3600 },
    });
    expect(issue.statusCode).toBe(201);
    const key = issue.json().data.key as string;

    const redeem = await app.inject({
      method: 'POST', url: '/api/v1/user-licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key },
    });
    expect(redeem.statusCode).toBe(200);

    const status = await app.inject({
      method: 'GET', url: '/api/v1/license-status',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(status.json().data.company.active).toBe(true);
    expect(status.json().data.user.active).toBe(true);

    const now = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(now.statusCode).toBe(200);
  }, REMOTE_DB_TIMEOUT_MS);

  it('el superadmin puede suspender y revocar licencias, bloqueando el acceso de nuevo', async () => {
    const listRes = await app.inject({
      method: 'GET', url: `/api/v1/platform/companies/${companyId}/licenses`,
      headers: { authorization: `Bearer ${platformToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const activeLicense = (listRes.json().data as Array<{ id: string; status: string }>).find((l) => l.status === 'ACTIVA');
    expect(activeLicense).toBeDefined();

    const suspend = await app.inject({
      method: 'POST', url: `/api/v1/platform/licenses/${activeLicense!.id}/suspend`,

      headers: { authorization: `Bearer ${platformToken}` },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().data.status).toBe('SUSPENDIDA');

    const blocked = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(blocked.statusCode).toBe(402);

    // Se reactiva para no dejar el estado roto antes de limpiar los datos de prueba.
    await app.inject({
      method: 'POST', url: `/api/v1/platform/licenses/${activeLicense!.id}/reactivate`,
      headers: { authorization: `Bearer ${platformToken}` },
    });
  }, REMOTE_DB_TIMEOUT_MS);
});
