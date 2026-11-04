import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as cashService from '../cash/service.js';
import * as companiesService from '../companies/service.js';
import * as productService from '../products/service.js';
import * as salesService from '../sales/service.js';
import * as invoicesService from './service.js';

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

describe.skipIf(!enabled)('Módulo de facturación', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;
  let saleId: string;
  let actorId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    actorId = randomUUID();
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Facturas Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
    const product = await productService.createProduct(
      ctx,
      companyId,
      { sku: `INV-${randomUUID().slice(0, 8)}`, name: 'Producto facturable', price: 25, type: 'BIEN', trackStock: true, minStock: 0, initialStock: 4 },
      { ip: null, userAgent: null },
    );
    const method = await admin.query<{ id: string }>(`SELECT id FROM payment_methods WHERE company_id = $1 AND code = 'TARJETA'`, [companyId]);
    const sale = await salesService.createSale(
      ctx,
      companyId,
      actorId,
      { items: [{ productId: product.id, quantity: 1, discount: 0 }], paymentMethodId: method.rows[0]!.id },
      { ip: null, userAgent: null },
    );
    saleId = sale.id;
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM invoice_items WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM invoices WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM payment_refunds WHERE company_id = $1`, [companyId]);
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

  it('emite una factura con consecutivo y copia las líneas de la venta', async () => {
    const invoice = await invoicesService.issueInvoice(ctx, companyId, saleId, actorId, { ip: null, userAgent: null });
    expect(invoice.full_number).toBe('FAC-000001');
    expect(invoice.total).toBe(25);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]?.description).toBe('Producto facturable');

    const printableInvoice = await invoicesService.getInvoice(ctx, companyId, invoice.id);
    expect(printableInvoice.full_number).toBe(invoice.full_number);
    expect(printableInvoice.company_name).toBe('Facturas Test');
    expect(printableInvoice.items[0]?.line_total).toBe(25);

    await expect(invoicesService.issueInvoice(ctx, companyId, saleId, actorId, { ip: null, userAgent: null }))
      .rejects.toMatchObject({ code: 'INVOICE_ALREADY_EXISTS' });
    const series = await admin.query<{ next_number: string }>(`SELECT next_number::text FROM invoice_series WHERE company_id = $1 AND is_default = true`, [companyId]);
    expect(Number(series.rows[0]?.next_number)).toBe(2);

    await invoicesService.cancelInvoice(ctx, companyId, invoice.id, actorId, 'Error de facturación', { ip: null, userAgent: null });
    const cancelledInvoice = await admin.query<{ status: string }>(`SELECT status FROM invoices WHERE company_id = $1 AND id = $2`, [companyId, invoice.id]);
    expect(cancelledInvoice.rows[0]?.status).toBe('ANULADA');

    await salesService.cancelSale(
      ctx,
      companyId,
      saleId,
      actorId,
      { reason: 'Devolución autorizada', refundReference: 'REF-TEST-001' },
      { ip: null, userAgent: null },
    );
    const refund = await admin.query<{ count: string }>(`SELECT count(*)::text AS count FROM payment_refunds WHERE company_id = $1 AND sale_id = $2`, [companyId, saleId]);
    expect(Number(refund.rows[0]?.count)).toBe(1);
    const stock = await admin.query<{ quantity: string }>(`SELECT quantity::text FROM inventory_stock WHERE company_id = $1`, [companyId]);
    expect(Number(stock.rows[0]?.quantity)).toBe(4);
  });
});
