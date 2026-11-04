import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';

// Requieren BD real; si faltan variables, el suite se omite (CI sin BD sigue verde).
const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL);

// Env mínimo para construir un AuthContext sin firmar tokens reales.
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

describe.skipIf(!enabled)('Módulo companies', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  const createdCompanies: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = {
      pool: appPool,
      env: testEnv,
      signAccessToken: () => 'test-token',
    };
  });

  afterAll(async () => {
    if (createdCompanies.length > 0) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [createdCompanies]);
    }
    if (createdUsers.length > 0) {
      await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
    }
    await appPool.end();
    await admin.end();
  });

  describe('createCompany', () => {
    it('crea una empresa con roles, impuestos, métodos de pago y serie sembrados', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'Acme Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: '127.0.0.1', userAgent: 'vitest' },
      );
      createdCompanies.push(company.id);

      expect(company.name).toBe('Acme Test');
      expect(company.status).toBe('ACTIVA');
      expect(company.currency).toBe('USD');

      // Seeds — verificados vía admin (bypassa RLS).
      const roles = await admin.query<{ name: string }>(
        `SELECT name FROM roles WHERE company_id = $1 ORDER BY name`,
        [company.id],
      );
      expect(roles.rows.map((r) => r.name)).toEqual(['Administrador', 'Vendedor']);

      const tax = await admin.query(
        `SELECT is_default FROM tax_rates WHERE company_id = $1`,
        [company.id],
      );
      expect(tax.rowCount).toBe(1);
      expect(tax.rows[0].is_default).toBe(true);

      const pm = await admin.query<{ code: string }>(
        `SELECT code FROM payment_methods WHERE company_id = $1 ORDER BY code`,
        [company.id],
      );
      expect(pm.rows.map((r) => r.code)).toEqual(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA']);

      const series = await admin.query(
        `SELECT is_default FROM invoice_series WHERE company_id = $1`,
        [company.id],
      );
      expect(series.rowCount).toBe(1);
      expect(series.rows[0].is_default).toBe(true);

      // El rol Administrador recibe TODOS los permisos sembrados.
      const adminPerms = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE r.company_id = $1 AND r.name = 'Administrador'`,
        [company.id],
      );
      expect(adminPerms.rows[0]!.n).toBeGreaterThan(20);
    });

    it('audita la creación de la empresa', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'Audit Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(company.id);

      const log = await admin.query<{ action: string; result: string }>(
        `SELECT action, result FROM audit_logs WHERE company_id = $1 ORDER BY id DESC LIMIT 1`,
        [company.id],
      );
      expect(log.rows[0]).toEqual({ action: 'company.created', result: 'OK' });
    });
  });

  describe('listCompanies', () => {
    it('lista empresas paginadas', async () => {
      const result = await service.listCompanies(ctx, { page: 1, limit: 100 });
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it('filtra por estado', async () => {
      const active = await service.listCompanies(ctx, {
        page: 1, limit: 100, status: 'ACTIVA',
      });
      expect(active.items.every((c) => c.status === 'ACTIVA')).toBe(true);
    });
  });

  describe('getCompany / updateCompany', () => {
    it('devuelve 404 si no existe', async () => {
      await expect(service.getCompany(ctx, randomUUID())).rejects.toMatchObject({
        code: 'COMPANY_NOT_FOUND',
        status: 404,
      });
    });

    it('actualiza nombre y locale', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'Old Name', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(company.id);

      const updated = await service.updateCompany(
        ctx,
        company.id,
        { name: 'New Name', locale: 'en' },
        { ip: null, userAgent: null },
      );
      expect(updated.name).toBe('New Name');
      expect(updated.locale).toBe('en');
    });
  });

  describe('setCompanyStatus', () => {
    it('suspende y reactiva', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'Status Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(company.id);

      const suspended = await service.setCompanyStatus(
        ctx, company.id, 'SUSPENDIDA', { ip: null, userAgent: null },
      );
      expect(suspended.status).toBe('SUSPENDIDA');

      const active = await service.setCompanyStatus(
        ctx, company.id, 'ACTIVA', { ip: null, userAgent: null },
      );
      expect(active.status).toBe('ACTIVA');
    });

    it('es idempotente: no audita si no hay cambio', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'Idem Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(company.id);

      const before = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1`,
        [company.id],
      );
      await service.setCompanyStatus(ctx, company.id, 'ACTIVA', { ip: null, userAgent: null });
      const after = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1`,
        [company.id],
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });
  });

  describe('getMyCompany', () => {
    it('devuelve la empresa del usuario', async () => {
      const company = await service.createCompany(
        ctx,
        { name: 'My Company', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(company.id);

      const userId = randomUUID();
      createdUsers.push(userId);
      await admin.query(
        `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'Tester')`,
        [userId, `u-${userId}@test.local`],
      );
      const roleId = (await admin.query<{ id: string }>(
        `SELECT id FROM roles WHERE company_id = $1 LIMIT 1`, [company.id],
      )).rows[0]!.id;
      await admin.query(
        `INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [company.id, userId, roleId],
      );

      const my = await service.getMyCompany(ctx, {
        userId, companyId: company.id, platform: false,
      });
      expect(my.id).toBe(company.id);
    });

    it('rechaza si el usuario no tiene empresa', async () => {
      await expect(
        service.getMyCompany(ctx, { userId: randomUUID(), companyId: null, platform: false }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('aislamiento (RLS)', () => {
    it('un miembro de la empresa A no ve la empresa B por /companies/me', async () => {
      const a = await service.createCompany(
        ctx, { name: 'A', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      const b = await service.createCompany(
        ctx, { name: 'B', currency: 'USD', locale: 'es', timezone: 'UTC' },
        { ip: null, userAgent: null },
      );
      createdCompanies.push(a.id, b.id);

      const userId = randomUUID();
      createdUsers.push(userId);
      await admin.query(
        `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'U')`,
        [userId, `u-${userId}@test.local`],
      );
      const roleA = (await admin.query<{ id: string }>(
        `SELECT id FROM roles WHERE company_id = $1 LIMIT 1`, [a.id],
      )).rows[0]!.id;
      await admin.query(
        `INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [a.id, userId, roleA],
      );

      const mine = await service.getMyCompany(ctx, {
        userId, companyId: a.id, platform: false,
      });
      expect(mine.id).toBe(a.id);

      await expect(
        service.getMyCompany(ctx, { userId, companyId: b.id, platform: false }),
      ).rejects.toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    });
  });
});