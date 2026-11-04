import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as suppliersService from './service.js';

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

describe.skipIf(!enabled)('Módulo de proveedores', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Proveedores Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await appPool.end();
    await admin.end();
  });

  it('crea, busca y desactiva proveedores en la empresa', async () => {
    const created = await suppliersService.createSupplier(
      ctx,
      companyId,
      { name: 'Distribuidora Norte', taxId: 'TAX-456', email: 'ventas@example.com', phone: '+1 555 0200' },
      { ip: null, userAgent: null },
    );

    expect(created.name).toBe('Distribuidora Norte');
    expect(created.company_id).toBe(companyId);

    const listed = await suppliersService.listSuppliers(ctx, companyId, { page: 1, limit: 20, search: 'Norte' });
    expect(listed.items.map((supplier) => supplier.id)).toContain(created.id);

    const inactive = await suppliersService.setSupplierStatus(
      ctx,
      companyId,
      created.id,
      false,
      { ip: null, userAgent: null },
    );
    expect(inactive.is_active).toBe(false);
  });
});
