import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as categoryService from '../categories/service.js';
import * as productService from './service.js';
import * as inventoryService from '../inventory/service.js';

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

describe.skipIf(!enabled)('Módulo de productos e inventario', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  const createdCompanies: string[] = [];

  async function newCompany(name: string): Promise<string> {
    const company = await companiesService.createCompany(
      ctx,
      { name, currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    createdCompanies.push(company.id);
    return company.id;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
  });

  afterAll(async () => {
    if (createdCompanies.length > 0) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM inventory_movements WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM inventory_stock WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM products WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM categories WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
      await admin.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [createdCompanies]);
    }
    await appPool.end();
    await admin.end();
  });

  it('crea categoría y producto en la empresa', async () => {
    const companyId = await newCompany('Productos A');
    const category = await categoryService.createCategory(ctx, companyId, { name: 'Limpieza', description: 'Productos de limpieza' }, { ip: null, userAgent: null });
    const product = await productService.createProduct(
      ctx,
      companyId,
      {
        categoryId: category.id,
        sku: `SKU-${randomUUID().slice(0, 6)}`,
        name: 'Detergente Lavanda',
        description: 'Botella 1L',
        type: 'BIEN',
        price: 12.5,
        cost: 7.5,
        trackStock: true,
        minStock: 2,
      },
      { ip: null, userAgent: null },
    );

    expect(product.categoryId).toBe(category.id);
    expect(product.sku).toMatch(/^SKU-/);
    expect(product.price).toBe(12.5);
  });

  it('ajusta stock y registra movimiento', async () => {
    const companyId = await newCompany('Productos B');
    const category = await categoryService.createCategory(ctx, companyId, { name: 'Bebidas' }, { ip: null, userAgent: null });
    const product = await productService.createProduct(
      ctx,
      companyId,
      {
        categoryId: category.id,
        sku: `INV-${randomUUID().slice(0, 6)}`,
        name: 'Agua',
        type: 'BIEN',
        price: 2,
        cost: 1,
        trackStock: true,
        minStock: 1,
      },
      { ip: null, userAgent: null },
    );

    const stock = await inventoryService.adjustStock(
      ctx,
      companyId,
      product.id,
      12,
      'ENTRADA',
      'Compra',
      null,
      { ip: null, userAgent: null },
      randomUUID(),
    );

    expect(stock.quantity).toBe(12);
    expect(stock.productId).toBe(product.id);
  });
});
