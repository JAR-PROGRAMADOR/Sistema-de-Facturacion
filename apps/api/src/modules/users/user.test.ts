import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPool } from '../../database/client.js';

vi.setConfig({
  testTimeout: 30000,
  hookTimeout: 30000,
});
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as rolesService from '../roles/service.js';
import * as service from './service.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL);

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  ACCESS_TOKEN_TTL_SECONDS: 600,
  REFRESH_TOKEN_TTL_DAYS: 7,
  SESSION_MAX_DAYS: 30,
  LOGIN_RATE_LIMIT_MAX: 10,
  FRONTEND_URL: 'http://localhost:5173',
  PASSWORD_RESET_TTL_MINUTES: 60,
  TWO_FACTOR_ISSUER: 'Test',
};

const STRONG_PWD = 'Test1!Secure#2024$XyZ';

describe.skipIf(!enabled)('Módulo users', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  const createdCompanies: string[] = [];

  async function newCompany(name: string): Promise<string> {
    const c = await companiesService.createCompany(
      ctx,
      { name, currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    createdCompanies.push(c.id);
    return c.id;
  }

  async function findRoleId(companyId: string, name: string): Promise<string> {
    const roles = await rolesService.listRoles(ctx, companyId);
    const r = roles.find((x) => x.name === name);
    if (!r) throw new Error(`Rol "${name}" no encontrado en ${companyId}`);
    return r.id;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
  });

  afterAll(async () => {
    if (createdCompanies.length > 0) {
      const users = await admin.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM company_users WHERE company_id = ANY($1::uuid[])`,
        [createdCompanies],
      );
      await admin.query(`DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM company_users WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM role_permissions WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM roles WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [createdCompanies]);
      const orphanIds = users.rows.map((r) => r.user_id);
      if (orphanIds.length > 0) {
        await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [orphanIds]);
      }
    }
    await appPool.end();
    await admin.end();
  });

  describe('createUser', () => {
    it('crea un usuario con rol y lo asigna a la empresa', async () => {
      const companyId = await newCompany('U Create');
      const vendedorId = await findRoleId(companyId, 'Vendedor');
      const email = `u-${randomUUID()}@test.local`;

      const user = await service.createUser(
        ctx, companyId,
        { email, fullName: 'Juan Test', password: STRONG_PWD, roleIds: [vendedorId] },
        { ip: null, userAgent: null },
      );

      expect(user.email).toBe(email);
      expect(user.fullName).toBe('Juan Test');
      expect(user.status).toBe('ACTIVO');
      expect(user.roles.map((r) => r.name)).toEqual(['Vendedor']);

      const dbUser = await admin.query(`SELECT email FROM users WHERE id = $1`, [user.id]);
      expect(dbUser.rowCount).toBe(1);

      const m = await admin.query(
        `SELECT role_id, status FROM company_users WHERE company_id = $1 AND user_id = $2`,
        [companyId, user.id],
      );
      expect(m.rowCount).toBe(1);
      expect(m.rows[0].role_id).toBe(vendedorId);
      expect(m.rows[0].status).toBe('ACTIVO');
    });

    it('rechaza email duplicado', async () => {
      const companyId = await newCompany('U Dup');
      const vendedorId = await findRoleId(companyId, 'Vendedor');
      const email = `u-${randomUUID()}@test.local`;

      await service.createUser(
        ctx, companyId,
        { email, fullName: 'First', password: STRONG_PWD, roleIds: [vendedorId] },
        { ip: null, userAgent: null },
      );

      await expect(
        service.createUser(
          ctx, companyId,
          { email, fullName: 'Second', password: STRONG_PWD, roleIds: [vendedorId] },
          { ip: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    });

    it('ignora un rol de otra empresa y asigna solo Vendedor', async () => {
      const a = await newCompany('U X A');
      const b = await newCompany('U X B');
      const roleA = await findRoleId(a, 'Vendedor');

      // Los roles pedidos al crear se ignoran: el usuario nace solo con el
      // Vendedor de su propia empresa, así que un rol ajeno ya no es error.
      const user = await service.createUser(
        ctx, b,
        { email: `u-${randomUUID()}@test.local`, fullName: 'X', password: STRONG_PWD, roleIds: [roleA] },
        { ip: null, userAgent: null },
      );

      expect(user.roles.map((r) => r.name)).toEqual(['Vendedor']);
    });

    it('asigna solo Vendedor aunque se pidan varios roles', async () => {
      const companyId = await newCompany('U Multi');
      const adminRoleId = await findRoleId(companyId, 'Administrador');
      const vendedorId = await findRoleId(companyId, 'Vendedor');

      const user = await service.createUser(
        ctx, companyId,
        {
          email: `u-${randomUUID()}@test.local`,
          fullName: 'Multi',
          password: STRONG_PWD,
          roleIds: [adminRoleId, vendedorId],
        },
        { ip: null, userAgent: null },
      );

      expect(user.roles.map((r) => r.name)).toEqual(['Vendedor']);
    });
  });

  describe('listUsers', () => {
    it('aísla por empresa', async () => {
      const a = await newCompany('U List A');
      const b = await newCompany('U List B');
      const vA = await findRoleId(a, 'Vendedor');
      const vB = await findRoleId(b, 'Vendedor');

      const ua = await service.createUser(
        ctx, a,
        { email: `u-${randomUUID()}@test.local`, fullName: 'A1', password: STRONG_PWD, roleIds: [vA] },
        { ip: null, userAgent: null },
      );
      const ub = await service.createUser(
        ctx, b,
        { email: `u-${randomUUID()}@test.local`, fullName: 'B1', password: STRONG_PWD, roleIds: [vB] },
        { ip: null, userAgent: null },
      );

      const la = await service.listUsers(ctx, a, { page: 1, limit: 100 });
      expect(la.items.map((u) => u.id)).toContain(ua.id);
      expect(la.items.map((u) => u.id)).not.toContain(ub.id);

      const lb = await service.listUsers(ctx, b, { page: 1, limit: 100 });
      expect(lb.items.map((u) => u.id)).toContain(ub.id);
      expect(lb.items.map((u) => u.id)).not.toContain(ua.id);
    });

    it('incluye todos los roles de cada usuario', async () => {
      const companyId = await newCompany('U List Roles');
      const ar = await findRoleId(companyId, 'Administrador');
      const vr = await findRoleId(companyId, 'Vendedor');

      const user = await service.createUser(
        ctx, companyId,
        {
          email: `u-${randomUUID()}@test.local`,
          fullName: 'Both',
          password: STRONG_PWD,
          roleIds: [ar, vr],
        },
        { ip: null, userAgent: null },
      );

      const result = await service.listUsers(ctx, companyId, { page: 1, limit: 100 });
      const found = result.items.find((u) => u.id === user.id);
      expect(found?.roles.length).toBe(2);
    });
  });

  describe('getUser', () => {
    it('404 si no existe', async () => {
      const companyId = await newCompany('U Get');
      await expect(service.getUser(ctx, companyId, randomUUID())).rejects.toMatchObject({
        code: 'USER_NOT_FOUND', status: 404,
      });
    });
  });

  describe('updateUser', () => {
    it('actualiza nombre y locale', async () => {
      const companyId = await newCompany('U Upd');
      const vr = await findRoleId(companyId, 'Vendedor');
      const user = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'Old', password: STRONG_PWD, roleIds: [vr] },
        { ip: null, userAgent: null },
      );

      const updated = await service.updateUser(
        ctx, companyId, user.id,
        { fullName: 'New', locale: 'en' },
        { ip: null, userAgent: null },
      );
      expect(updated.fullName).toBe('New');
      expect(updated.locale).toBe('en');
    });

    it('reemplaza roles', async () => {
      const companyId = await newCompany('U UpdRoles');
      const ar = await findRoleId(companyId, 'Administrador');
      const vr = await findRoleId(companyId, 'Vendedor');

      // Creamos dos admins para no violar LAST_ADMIN al mover uno.
      await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'U1', password: STRONG_PWD, roleIds: [ar] },
        { ip: null, userAgent: null },
      );
      const u2 = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'U2', password: STRONG_PWD, roleIds: [vr] },
        { ip: null, userAgent: null },
      );

      const updated = await service.updateUser(
        ctx, companyId, u2.id,
        { roleIds: [ar] },
        { ip: null, userAgent: null },
      );
      expect(updated.roles.map((r) => r.name)).toEqual(['Administrador']);
    });

    it('rechaza asignar rol de otra empresa', async () => {
      const a = await newCompany('U UpdX A');
      const b = await newCompany('U UpdX B');
      const vA = await findRoleId(a, 'Vendedor');
      const vB = await findRoleId(b, 'Vendedor');

      const user = await service.createUser(
        ctx, b,
        { email: `u-${randomUUID()}@test.local`, fullName: 'U', password: STRONG_PWD, roleIds: [vB] },
        { ip: null, userAgent: null },
      );

      await expect(
        service.updateUser(ctx, b, user.id, { roleIds: [vA] }, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'ROLE_CROSS_COMPANY', status: 400 });
    });

    it('rechaza quitar el rol al último Administrador activo', async () => {
      const companyId = await newCompany('U LastAdminRole');
      const ar = await findRoleId(companyId, 'Administrador');
      const vr = await findRoleId(companyId, 'Vendedor');

      const user = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'A', password: STRONG_PWD, roleIds: [ar] },
        { ip: null, userAgent: null },
      );

      await expect(
        service.updateUser(ctx, companyId, user.id, { roleIds: [vr] }, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
    });

    it('rechaza desactivar al último Administrador activo', async () => {
      const companyId = await newCompany('U LastAdminStatus');
      const ar = await findRoleId(companyId, 'Administrador');

      const user = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'A', password: STRONG_PWD, roleIds: [ar] },
        { ip: null, userAgent: null },
      );

      await expect(
        service.updateUser(ctx, companyId, user.id, { status: 'INACTIVO' }, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
    });
  });

  describe('deactivateUser', () => {
    it('desactiva sin borrar al usuario', async () => {
      const companyId = await newCompany('U Del');
      const vr = await findRoleId(companyId, 'Vendedor');
      const user = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'T', password: STRONG_PWD, roleIds: [vr] },
        { ip: null, userAgent: null },
      );

      await service.deactivateUser(ctx, companyId, user.id, { ip: null, userAgent: null });

      const stillThere = await admin.query(`SELECT id FROM users WHERE id = $1`, [user.id]);
      expect(stillThere.rowCount).toBe(1);

      const m = await admin.query(
        `SELECT status FROM company_users WHERE company_id = $1 AND user_id = $2`,
        [companyId, user.id],
      );
      expect(m.rows[0].status).toBe('INACTIVO');

      const fetched = await service.getUser(ctx, companyId, user.id);
      expect(fetched.status).toBe('INACTIVO');
    });

    it('rechaza desactivar al último Administrador activo', async () => {
      const companyId = await newCompany('U DelLastAdmin');
      const ar = await findRoleId(companyId, 'Administrador');
      const user = await service.createUser(
        ctx, companyId,
        { email: `u-${randomUUID()}@test.local`, fullName: 'A', password: STRONG_PWD, roleIds: [ar] },
        { ip: null, userAgent: null },
      );

      await expect(
        service.deactivateUser(ctx, companyId, user.id, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
    });
  });

  describe('aislamiento (RLS)', () => {
    it('un usuario de la empresa A no es visible desde la empresa B', async () => {
      const a = await newCompany('U Iso A');
      const b = await newCompany('U Iso B');
      const vA = await findRoleId(a, 'Vendedor');

      const user = await service.createUser(
        ctx, a,
        { email: `u-${randomUUID()}@test.local`, fullName: 'A', password: STRONG_PWD, roleIds: [vA] },
        { ip: null, userAgent: null },
      );

      await expect(service.getUser(ctx, b, user.id)).rejects.toMatchObject({
        code: 'USER_NOT_FOUND', status: 404,
      });
    });
  });
});