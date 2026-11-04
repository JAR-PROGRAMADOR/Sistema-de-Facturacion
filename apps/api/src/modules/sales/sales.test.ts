import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as cashService from '../cash/service.js';
import * as productService from '../products/service.js';
import * as salesService from './service.js';

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

describe.skipIf(!enabled)('Módulo de ventas', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;
  let productId: string;
  let paymentMethodId: string;
  let cashSessionId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Ventas Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
    const product = await productService.createProduct(
      ctx,
      companyId,
      { sku: `SALE-${randomUUID().slice(0, 8)}`, name: 'Producto venta', price: 10, type: 'BIEN', trackStock: true, minStock: 0, initialStock: 5 },
      { ip: null, userAgent: null },
    );
    productId = product.id;
    const method = await admin.query<{ id: string }>(`SELECT id FROM payment_methods WHERE company_id = $1 AND code = 'EFECTIVO'`, [companyId]);
    paymentMethodId = method.rows[0]!.id;
    const cashSession = await cashService.openCashSession(ctx, companyId, actorId, 0, { ip: null, userAgent: null });
    cashSessionId = cashSession.id;
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM payment_refunds WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM payments WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM sales WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM cash_movements WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM cash_sessions WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_movements WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_stock WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM products WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await appPool.end();
    await admin.end();
  });

  it('calcula venta, registra pago y descuenta stock dentro de la empresa', async () => {
    const sale = await salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 2, discount: 0 }], paymentMethodId, cashSessionId },
      { ip: null, userAgent: null },
    );

    expect(sale.total).toBe(20);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0]?.productName).toBe('Producto venta');

    const stock = await admin.query<{ quantity: string }>(`SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2`, [companyId, productId]);
    const payments = await admin.query<{ count: string }>(`SELECT count(*)::text AS count FROM payments WHERE company_id = $1 AND sale_id = $2`, [companyId, sale.id]);
    expect(Number(stock.rows[0]?.quantity)).toBe(3);
    expect(Number(payments.rows[0]?.count)).toBe(1);
    const cash = await admin.query<{ count: string }>(`SELECT count(*)::text AS count FROM cash_movements WHERE company_id = $1 AND cash_session_id = $2`, [companyId, cashSessionId]);
    expect(Number(cash.rows[0]?.count)).toBe(1);
    const closed = await cashService.closeCashSession(ctx, companyId, actorId, cashSessionId, 20, { ip: null, userAgent: null });
    expect(closed.closing_amount_expected).toBe(20);
  });

  it('revierte la venta cuando no hay stock suficiente', async () => {
    const cashSession = await cashService.openCashSession(ctx, companyId, actorId, 0, { ip: null, userAgent: null });
    cashSessionId = cashSession.id;
    await expect(salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 99, discount: 0 }], paymentMethodId, cashSessionId },
      { ip: null, userAgent: null },
    )).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    const sales = await admin.query<{ count: string }>(`SELECT count(*)::text AS count FROM sales WHERE company_id = $1`, [companyId]);
    expect(Number(sales.rows[0]?.count)).toBe(1);
  });

  it('aplica las preferencias de venta guardadas por la empresa', async () => {
    await admin.query(
      `UPDATE company_settings SET data = data || '{"requireCustomerOnSale":true}'::jsonb WHERE company_id = $1`,
      [companyId],
    );
    await expect(salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 1, discount: 0 }], paymentMethodId, cashSessionId },
      { ip: null, userAgent: null },
    )).rejects.toMatchObject({ code: 'CUSTOMER_REQUIRED' });
    await admin.query(
      `UPDATE company_settings SET data = data || '{"requireCustomerOnSale":false}'::jsonb WHERE company_id = $1`,
      [companyId],
    );
  });

  it('cancela una venta en efectivo con caja abierta y compensa ingreso/egreso', async () => {
    const sale = await salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 1, discount: 0 }], paymentMethodId, cashSessionId },
      { ip: null, userAgent: null },
    );
    await salesService.cancelSale(
      ctx,
      companyId,
      sale.id,
      actorId,
      { reason: 'Cobro duplicado' },
      { ip: null, userAgent: null },
    );
    const refunds = await admin.query<{ count: string }>(`SELECT count(*)::text AS count FROM payment_refunds WHERE company_id = $1 AND sale_id = $2`, [companyId, sale.id]);
    const movements = await admin.query<{ net: string }>(
      `SELECT COALESCE(sum(CASE WHEN type = 'INGRESO' THEN amount ELSE -amount END),0)::text AS net
         FROM cash_movements WHERE company_id = $1 AND cash_session_id = $2`,
      [companyId, cashSessionId],
    );
    expect(Number(refunds.rows[0]?.count)).toBe(1);
    expect(Number(movements.rows[0]?.net)).toBe(0);
  });
});
