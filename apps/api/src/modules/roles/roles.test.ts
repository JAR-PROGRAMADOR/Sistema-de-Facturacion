import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as companiesService from '../companies/service.js';
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

describe.skipIf(!enabled)('Módulo roles', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  const createdCompanies: string[] = [];
  const createdUsers: string[] = [];

  /** Crea empresa con seeds y devuelve su id. */
  async function newCompany(name: string): Promise<string> {
    const c = await companiesService.createCompany(
      ctx,
      { name, currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    createdCompanies.push(c.id);
    return c.id;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
  });

  afterAll(async () => {
    if (createdCompanies.length > 0) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM company_users WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM role_permissions WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM roles WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [createdCompanies]);
    }
    if (createdUsers.length > 0) {
      await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
    }
    await appPool.end();
    await admin.end();
  });

  describe('listPermissions', () => {
    it('devuelve el catálogo global (>= 20)', async () => {
      const perms = await service.listPermissions(ctx);
      expect(perms.length).toBeGreaterThanOrEqual(20);
      expect(perms[0]).toHaveProperty('code');
      expect(perms[0]).toHaveProperty('description');
    });
  });

  describe('createRole', () => {
    it('crea un rol con permisos', async () => {
      const companyId = await newCompany('Roles Create');
      const catalog = await service.listPermissions(ctx);
      const codes = catalog.slice(0, 3).map((p) => p.code);

      const role = await service.createRole(
        ctx, companyId,
        { name: 'Operador', description: 'Rol de prueba', permissionCodes: codes },
        { ip: null, userAgent: null },
      );

      expect(role.name).toBe('Operador');
      expect(role.isSystem).toBe(false);
      expect(role.permissionCodes.sort()).toEqual([...codes].sort());
    });

    it('rechaza nombre duplicado (case-insensitive)', async () => {
      const companyId = await newCompany('Roles Dup');
      await service.createRole(
        ctx, companyId, { name: 'Contable' }, { ip: null, userAgent: null },
      );
      await expect(
        service.createRole(ctx, companyId, { name: 'contable' }, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'ROLE_NAME_TAKEN', status: 409 });
    });

    it('audita la creación', async () => {
      const companyId = await newCompany('Roles Audit');
      const role = await service.createRole(
        ctx, companyId, { name: 'Auditor' }, { ip: null, userAgent: null },
      );
      const log = await admin.query<{ action: string }>(
        `SELECT action FROM audit_logs
          WHERE company_id = $1 AND action = 'role.created'
            AND metadata->>'roleId' = $2 LIMIT 1`,
        [companyId, role.id],
      );
      expect(log.rowCount).toBe(1);
    });
  });

  describe('listRoles / getRole', () => {
    it('incluye los roles del sistema', async () => {
      const companyId = await newCompany('Roles List');
      const roles = await service.listRoles(ctx, companyId);
      const names = roles.map((r) => r.name);
      expect(names).toContain('Administrador');
      expect(names).toContain('Vendedor');
      expect(roles.every((r) => r.isSystem)).toBe(true);
    });

    it('404 si el rol no existe', async () => {
      const companyId = await newCompany('Roles Get');
      await expect(service.getRole(ctx, companyId, randomUUID())).rejects.toMatchObject({
        code: 'ROLE_NOT_FOUND', status: 404,
      });
    });
  });

  describe('updateRole', () => {
    it('actualiza nombre y descripción', async () => {
      const companyId = await newCompany('Roles Update');
      const role = await service.createRole(
        ctx, companyId, { name: 'Antiguo' }, { ip: null, userAgent: null },
      );
      const updated = await service.updateRole(
        ctx, companyId, role.id,
        { name: 'Nuevo', description: 'Actualizado' },
        { ip: null, userAgent: null },
      );
      expect(updated.name).toBe('Nuevo');
      expect(updated.description).toBe('Actualizado');
    });
  });

  describe('deleteRole', () => {
    it('rechaza borrar un rol del sistema', async () => {
      const companyId = await newCompany('Roles DelSystem');
      const roles = await service.listRoles(ctx, companyId);
      const sys = roles.find((r) => r.isSystem)!;
      await expect(
        service.deleteRole(ctx, companyId, sys.id, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'SYSTEM_ROLE_READONLY', status: 409 });
    });

    it('rechaza borrar un rol con usuarios activos', async () => {
      const companyId = await newCompany('Roles DelInUse');
      const role = await service.createRole(
        ctx, companyId, { name: 'EnUso' }, { ip: null, userAgent: null },
      );

      // Insertar usuario + membership con ese rol
      const userId = randomUUID();
      createdUsers.push(userId);
      await admin.query(
        `INSERT INTO users (id, email, password_hash, full_name)
         VALUES ($1, $2, 'x', 'T')`,
        [userId, `u-${userId}@test.local`],
      );
      await admin.query(
        `INSERT INTO company_users (company_id, user_id, role_id, status)
         VALUES ($1, $2, $3, 'ACTIVO')`,
        [companyId, userId, role.id],
      );

      await expect(
        service.deleteRole(ctx, companyId, role.id, { ip: null, userAgent: null }),
      ).rejects.toMatchObject({ code: 'ROLE_IN_USE', status: 409 });
    });

    it('borra un rol custom sin usuarios', async () => {
      const companyId = await newCompany('Roles DelOk');
      const role = await service.createRole(
        ctx, companyId, { name: 'Temporal' }, { ip: null, userAgent: null },
      );
      await service.deleteRole(ctx, companyId, role.id, { ip: null, userAgent: null });
      await expect(service.getRole(ctx, companyId, role.id)).rejects.toMatchObject({
        code: 'ROLE_NOT_FOUND',
      });
    });
  });

  describe('setRolePermissions', () => {
    it('reemplaza el set de permisos atómicamente', async () => {
      const companyId = await newCompany('Roles SetPerms');
      const catalog = await service.listPermissions(ctx);
      const role = await service.createRole(
        ctx, companyId, { name: 'Editor', permissionCodes: [catalog[0]!.code] },
        { ip: null, userAgent: null },
      );

      const next = [catalog[1]!.code, catalog[2]!.code];
      const updated = await service.setRolePermissions(
        ctx, companyId, role.id, { permissionCodes: next },
        { ip: null, userAgent: null },
      );
      expect(updated.permissionCodes.sort()).toEqual([...next].sort());
    });

    it('rechaza códigos desconocidos', async () => {
      const companyId = await newCompany('Roles BadPerm');
      const role = await service.createRole(
        ctx, companyId, { name: 'X' }, { ip: null, userAgent: null },
      );
      await expect(
        service.setRolePermissions(
          ctx, companyId, role.id,
          { permissionCodes: ['NO_EXISTE:ESE_CODIGO'] },
          { ip: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: 'UNKNOWN_PERMISSION', status: 400 });
    });
  });

  describe('aislamiento (RLS)', () => {
    it('un rol de la empresa A no es visible desde la empresa B', async () => {
      const a = await newCompany('A');
      const b = await newCompany('B');
      const roleA = await service.createRole(
        ctx, a, { name: 'SoloA' }, { ip: null, userAgent: null },
      );
      await expect(service.getRole(ctx, b, roleA.id)).rejects.toMatchObject({
        code: 'ROLE_NOT_FOUND',
      });
    });
  });

  describe('errores tipados', () => {
    it('ROLE_NOT_FOUND es AppError con status 404', async () => {
      const companyId = await newCompany('Roles Err');
      const err = await service
        .getRole(ctx, companyId, randomUUID())
        .catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(404);
    });
  });
});