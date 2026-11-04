import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { createPool } from '../database/client.js';
import { hashPassword } from './auth/password.js';

const enabled = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL && process.env.JWT_ACCESS_SECRET,
);

const REMOTE_DB_TIMEOUT_MS = 20_000;

describe.skipIf(!enabled)('Empresas, usuarios, roles y permisos (FASE 4, con licencias de FASE 5)', () => {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
  let admin: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const platformUserId = randomUUID();
  const platformEmail = `platform-${randomUUID()}@example.test`;
  const platformPassword = 'clave-superadmin-larga-123';
  let platformToken: string;

  let companyId: string;
  let adminRoleId: string;
  let vendorRoleId: string;
  let adminUserId: string;
  const adminEmail = `empresa-admin-${randomUUID()}@example.test`;
  const adminPassword = 'clave-admin-empresa-456';
  let adminAccessToken: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, is_platform_admin)
       VALUES ($1, $2, $3, 'Superadmin de prueba', true)`,
      [platformUserId, platformEmail, await hashPassword(platformPassword)],
    );

    const pool = createPool(process.env.DATABASE_URL!);
    app = await buildApp({ env, pool });

    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: platformEmail, password: platformPassword },
    });
    expect(login.statusCode).toBe(200);
    platformToken = login.json().data.accessToken as string;
  }, REMOTE_DB_TIMEOUT_MS);

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM user_licenses WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM licenses WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM sessions WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM company_users WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM role_permissions WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await admin.query(`DELETE FROM users WHERE email = ANY($1::text[]) OR id = $2`, [[platformEmail, adminEmail], platformUserId]);
    await app.close();
    await admin.end();
  }, REMOTE_DB_TIMEOUT_MS);

  /** Emite (como plataforma) y canjea (como el usuario indicado) una licencia. */
  async function issueAndRedeemCompanyLicense(userToken: string): Promise<void> {
    const issue = await app.inject({
      method: 'POST', url: '/api/v1/platform/licenses',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { companyId, durationSeconds: 3600, maxUsers: 10 },
    });
    expect(issue.statusCode).toBe(201);
    const key = issue.json().data.key as string;

    const redeem = await app.inject({
      method: 'POST', url: '/api/v1/licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key },
    });
    expect(redeem.statusCode).toBe(200);
  }

  async function issueAndRedeemUserLicense(forUserId: string, userToken: string): Promise<void> {
    const issue = await app.inject({
      method: 'POST', url: '/api/v1/platform/user-licenses',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { companyId, userId: forUserId, durationSeconds: 3600 },
    });
    expect(issue.statusCode).toBe(201);
    const key = issue.json().data.key as string;

    const redeem = await app.inject({
      method: 'POST', url: '/api/v1/user-licenses/redeem',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { key },
    });
    expect(redeem.statusCode).toBe(200);
  }

  it('el superadmin crea una empresa con su administrador inicial, con roles sembrados', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/v1/platform/companies',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { name: 'Empresa de prueba FASE 4', adminEmail, adminFullName: 'Admin de prueba' },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json().data;
    companyId = body.company.id;
    adminRoleId = body.adminRoleId;
    vendorRoleId = body.vendorRoleId;
    expect(body.adminUserCreated).toBe(true);

    await admin.query('UPDATE users SET password_hash = $2 WHERE email = $1', [adminEmail, await hashPassword(adminPassword)]);
  }, REMOTE_DB_TIMEOUT_MS);

  it('sin licencia activa, hasta el administrador de la empresa queda bloqueado (402)', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: adminEmail, password: adminPassword },
    });
    expect(login.statusCode).toBe(200);
    adminAccessToken = login.json().data.accessToken;
    adminUserId = login.json().data.user.id;

    const blocked = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().error.code).toBe('LICENSE_EXPIRED');

    // /license-status sí funciona sin licencia activa (es la vía de escape).
    const status = await app.inject({
      method: 'GET', url: '/api/v1/license-status',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.company.active).toBe(false);
    expect(status.json().data.user.active).toBe(false);
  }, REMOTE_DB_TIMEOUT_MS);

  it('al canjear la licencia de empresa y la del administrador, el bloqueo se levanta', async () => {
    await issueAndRedeemCompanyLicense(adminAccessToken);
    await issueAndRedeemUserLicense(adminUserId, adminAccessToken);

    const nowAllowed = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(nowAllowed.statusCode).toBe(200);
  }, REMOTE_DB_TIMEOUT_MS);

  it('un usuario que no es plataforma no puede crear empresas', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/platform/companies',
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { name: 'Intrusa' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  }, REMOTE_DB_TIMEOUT_MS);

  it('el administrador de la empresa (con roles.manage) puede crear un rol personalizado', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { name: 'Contador', description: 'Solo reportes', permissionCodes: ['reports.view'] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.permissionCodes).toEqual(['reports.view']);
  }, REMOTE_DB_TIMEOUT_MS);

  it('el administrador crea un usuario Vendedor; con licencia pero sin permiso, recibe 403 (no 402)', async () => {
    const vendorEmail = `vendedor-${randomUUID()}@example.test`;
    const createUser = await app.inject({
      method: 'POST', url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { email: vendorEmail, fullName: 'Vendedor de prueba', roleId: vendorRoleId },
    });
    expect(createUser.statusCode).toBe(201);
    expect(createUser.json().data.role_name).toBe('Vendedor');
    const vendorUserId = createUser.json().data.user_id as string;

    const vendorPassword = 'clave-vendedor-larga-789';
    await admin.query('UPDATE users SET password_hash = $2 WHERE email = $1', [vendorEmail, await hashPassword(vendorPassword)]);

    const vendorLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: vendorEmail, password: vendorPassword },
    });
    expect(vendorLogin.statusCode).toBe(200);
    const vendorToken = vendorLogin.json().data.accessToken;

    // Sin licencia de usuario todavía: debe bloquear por licencia, no por permiso.
    const withoutLicense = await app.inject({
      method: 'POST', url: '/api/v1/users',
      headers: { authorization: `Bearer ${vendorToken}` },
      payload: { email: `otro-${randomUUID()}@example.test`, fullName: 'Otro', roleId: vendorRoleId },
    });
    expect(withoutLicense.statusCode).toBe(402);

    // Se licencia al vendedor: ahora el bloqueo pasa a ser por permiso (403), no por licencia.
    await issueAndRedeemUserLicense(vendorUserId, vendorToken);
    const forbidden = await app.inject({
      method: 'POST', url: '/api/v1/users',
      headers: { authorization: `Bearer ${vendorToken}` },
      payload: { email: `otro-${randomUUID()}@example.test`, fullName: 'Otro', roleId: vendorRoleId },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');

    const roles = await app.inject({
      method: 'GET', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    const vendorRole = (roles.json().data as Array<{ id: string; permissionCodes: string[] }>).find((r) => r.id === vendorRoleId);
    expect(vendorRole?.permissionCodes).toContain('pos.use');
  }, REMOTE_DB_TIMEOUT_MS);

  it('no se puede eliminar un rol del sistema', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/roles/${adminRoleId}`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SYSTEM_ROLE_READONLY');
  }, REMOTE_DB_TIMEOUT_MS);

  it('el superadmin puede suspender y reactivar la empresa', async () => {
    const suspend = await app.inject({
      method: 'PATCH', url: `/api/v1/platform/companies/${companyId}`,
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { status: 'SUSPENDIDA' },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().data.status).toBe('SUSPENDIDA');

    const reactivate = await app.inject({
      method: 'PATCH', url: `/api/v1/platform/companies/${companyId}`,
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { status: 'ACTIVA' },
    });
    expect(reactivate.statusCode).toBe(200);
  }, REMOTE_DB_TIMEOUT_MS);
});
