import pg from 'pg';
import { createPool } from './client.js';
import { loadEnv } from '../config/env.js';
import type { AuthContext } from '../modules/auth/service.js';
import * as companiesService from '../modules/companies/service.js';
import * as productsService from '../modules/products/service.js';
import * as salesService from '../modules/sales/service.js';

const companyName = 'Empresa Demo - Gráfica de ventas';
const productDefinitions = [
  { sku: 'DEMO-VENTAS-01', name: 'Consulta de negocio', price: 45 },
  { sku: 'DEMO-VENTAS-02', name: 'Servicio profesional', price: 85 },
  { sku: 'DEMO-VENTAS-03', name: 'Paquete empresarial', price: 145 },
] as const;
const targetSales = 60;
const meta = { ip: null, userAgent: 'demo-sales-seed' };

async function seedDemoSales(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL || !env.DATABASE_ADMIN_URL) {
    throw new Error('DATABASE_URL y DATABASE_ADMIN_URL son necesarios para crear la empresa de demostración.');
  }

  const appPool = createPool(env.DATABASE_URL);
  const admin = new pg.Pool({ connectionString: env.DATABASE_ADMIN_URL });
  const ctx: AuthContext = { pool: appPool, env, signAccessToken: () => 'demo-seed' };

  try {
    const platformAdmin = await admin.query<{ id: string; email: string; full_name: string }>(
      `SELECT id, email, full_name FROM users
        WHERE is_platform_admin = true AND status = 'ACTIVO'
        ORDER BY created_at LIMIT 1`,
    );
    const actor = platformAdmin.rows[0];
    if (!actor) throw new Error('No hay un administrador activo de plataforma para asociar a la empresa demo.');

    const existingCompany = await admin.query<{ id: string }>(
      `SELECT id FROM companies WHERE name = $1 LIMIT 1`,
      [companyName],
    );
    let companyId = existingCompany.rows[0]?.id;
    if (!companyId) {
      const company = await companiesService.createCompany(
        ctx,
        {
          name: companyName,
          currency: 'USD',
          locale: 'es',
          timezone: 'UTC',
          adminEmail: actor.email,
          adminFullName: actor.full_name,
        },
        meta,
      );
      companyId = company.id;
    }

    const productIds: string[] = [];
    for (const definition of productDefinitions) {
      const existingProduct = await admin.query<{ id: string }>(
        `SELECT id FROM products WHERE company_id = $1 AND sku = $2 AND deleted_at IS NULL`,
        [companyId, definition.sku],
      );
      const product = existingProduct.rows[0] ?? await productsService.createProduct(
        ctx,
        companyId,
        {
          sku: definition.sku,
          name: definition.name,
          type: 'SERVICIO',
          price: definition.price,
          cost: 0,
          trackStock: false,
          minStock: 0,
          initialStock: 0,
        },
        meta,
      );
      productIds.push(product.id);
    }

    const method = await admin.query<{ id: string }>(
      `SELECT id FROM payment_methods WHERE company_id = $1 AND code = 'TARJETA'`,
      [companyId],
    );
    if (!method.rows[0]) throw new Error('La empresa demo no tiene el método de pago TARJETA.');

    const existingSales = await admin.query<{ count: number }>(
      `SELECT count(DISTINCT s.id)::int AS count
         FROM sales s
         JOIN sale_items si ON si.company_id = s.company_id AND si.sale_id = s.id
        WHERE s.company_id = $1 AND si.product_id = ANY($2::uuid[])`,
      [companyId, productIds],
    );
    const alreadySeeded = existingSales.rows[0]?.count ?? 0;
    for (let index = alreadySeeded; index < targetSales; index += 1) {
      const productId = productIds[index % productIds.length]!;
      const sale = await salesService.createSale(
        ctx,
        companyId,
        actor.id,
        { paymentMethodId: method.rows[0].id, items: [{ productId, quantity: 1, discount: 0 }] },
        meta,
      );
      const dayIndex = Math.floor(index * 30 / targetSales);
      const soldAt = new Date();
      soldAt.setUTCHours(12, 0, 0, 0);
      soldAt.setUTCDate(soldAt.getUTCDate() - (29 - dayIndex));
      await admin.query(
        `UPDATE sales SET sold_at = $3 WHERE company_id = $1 AND id = $2`,
        [companyId, sale.id, soldAt],
      );
    }

    console.log(`Empresa demo lista: ${companyName} (${companyId}); ${targetSales} ventas en los últimos 30 días.`);
  } finally {
    await Promise.all([appPool.end(), admin.end()]);
  }
}

seedDemoSales().catch((error: unknown) => {
  console.error('No fue posible crear los datos de demostración:', error);
  process.exitCode = 1;
});
