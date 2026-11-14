import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as productService from '../products/service.js';
import * as salesService from '../sales/service.js';
import * as auditService from '../audit/service.js';
import * as reportsService from './service.js';

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

describe.skipIf(!enabled)('Reportes y auditoría', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;
  let productId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Reportes Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
    const product = await productService.createProduct(
      ctx,
      companyId,
      { sku: `REP-${randomUUID().slice(0, 8)}`, name: 'Producto de reporte', price: 12, type: 'BIEN', trackStock: true, minStock: 2, initialStock: 2 },
      { ip: null, userAgent: null },
    );
    productId = product.id;
    const method = await admin.query<{ id: string }>(`SELECT id FROM payment_methods WHERE company_id = $1 AND code = 'TARJETA'`, [companyId]);
    await salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 1, discount: 0 }], paymentMethodId: method.rows[0]!.id },
      { ip: null, userAgent: null },
    );
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM payments WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM sales WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_movements WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_stock WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM products WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await appPool.end();
    await admin.end();
  });

  it('resume ventas, detecta stock bajo y filtra auditoría real', async () => {
    const period = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const summary = await reportsService.getSalesSummary(ctx, companyId, period);
    expect(summary.salesCount).toBe(1);
    expect(summary.total).toBe(12);
    // El producto no tiene costo, así que el costo es 0 y la utilidad es el total.
    expect(summary.totalCost).toBe(0);
    expect(summary.grossProfit).toBe(12);
    expect(summary.daily).toHaveLength(1);
    expect(summary.daily[0]?.cost).toBe(0);

    const top = await reportsService.getTopProducts(ctx, companyId, { ...period, limit: 10 });
    expect(top[0]?.name).toBe('Producto de reporte');
    expect(top[0]?.quantity).toBe(1);

    const lowStock = await reportsService.getLowStock(ctx, companyId);
    expect(lowStock).toEqual([{ productId, sku: expect.any(String), name: 'Producto de reporte', quantity: 1, minStock: 2 }]);

    const audit = await auditService.listAuditLogs(ctx, companyId, { page: 1, limit: 20, action: 'sale.created' });
    expect(audit.total).toBe(1);
    expect(audit.items[0]?.action).toBe('sale.created');
  });
});
