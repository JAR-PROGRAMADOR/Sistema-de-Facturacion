import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as productService from '../products/service.js';
import * as salesService from '../sales/service.js';
import * as suppliersService from '../suppliers/service.js';
import * as purchasesService from './service.js';

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

describe.skipIf(!enabled)('Recepción de compras', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;
  let productId: string;
  let supplierId: string;
  let paymentMethodId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Compras Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
    const supplier = await suppliersService.createSupplier(
      ctx, companyId, { name: 'Proveedor test' }, { ip: null, userAgent: null },
    );
    supplierId = supplier.id;
    const product = await productService.createProduct(
      ctx,
      companyId,
      { sku: `BUY-${randomUUID().slice(0, 8)}`, name: 'Producto comprado', price: 10, type: 'BIEN', trackStock: true, minStock: 0, initialStock: 2 },
      { ip: null, userAgent: null },
    );
    productId = product.id;
    const method = await admin.query<{ id: string }>(`SELECT id FROM payment_methods WHERE company_id = $1 AND code = 'TARJETA'`, [companyId]);
    paymentMethodId = method.rows[0]!.id;
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM payments WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM sales WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM purchases WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_movements WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM inventory_stock WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM products WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await appPool.end();
    await admin.end();
  });

  it('recibe productos, incrementa stock y solo anula si el stock sigue disponible', async () => {
    const first = await purchasesService.createPurchase(
      ctx,
      companyId,
      actorId,
      { supplierId, paymentMethodId, items: [{ productId, quantity: 3, unitCost: 4 }] },
      { ip: null, userAgent: null },
    );
    expect(first.total).toBe(12);
    const recordedMethod = await admin.query<{ payment_method_id: string | null }>(
      `SELECT payment_method_id FROM purchases WHERE company_id = $1 AND id = $2`,
      [companyId, first.id],
    );
    expect(recordedMethod.rows[0]?.payment_method_id).toBe(paymentMethodId);
    let stock = await admin.query<{ quantity: string }>(`SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2`, [companyId, productId]);
    expect(Number(stock.rows[0]?.quantity)).toBe(5);

    await purchasesService.cancelPurchase(ctx, companyId, first.id, actorId, 'Recepción duplicada', { ip: null, userAgent: null });
    stock = await admin.query<{ quantity: string }>(`SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2`, [companyId, productId]);
    expect(Number(stock.rows[0]?.quantity)).toBe(2);

    const second = await purchasesService.createPurchase(
      ctx,
      companyId,
      actorId,
      { supplierId, items: [{ productId, quantity: 3, unitCost: 4 }] },
      { ip: null, userAgent: null },
    );
    const sale = await salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId, quantity: 3, discount: 0 }], paymentMethodId },
      { ip: null, userAgent: null },
    );
    expect(sale.total).toBe(30);

    await expect(purchasesService.cancelPurchase(ctx, companyId, second.id, actorId, 'Reverso', { ip: null, userAgent: null }))
      .rejects.toMatchObject({ code: 'PURCHASE_STOCK_ALREADY_CONSUMED' });
    const stillReceived = await admin.query<{ status: string }>(`SELECT status FROM purchases WHERE company_id = $1 AND id = $2`, [companyId, second.id]);
    expect(stillReceived.rows[0]?.status).toBe('RECIBIDA');
  }, 20_000);
});
