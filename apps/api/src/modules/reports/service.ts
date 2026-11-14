import { withContext } from '../../database/client.js';
import type { AuthContext } from '../auth/service.js';

interface DateRange {
  from?: Date;
  to?: Date;
}

function range(query: DateRange): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to.getTime() + 86_400_000) : new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

export async function getSalesSummary(
  ctx: AuthContext,
  companyId: string,
  query: DateRange,
): Promise<{
  from: Date;
  to: Date;
  salesCount: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  daily: Array<{ day: string; salesCount: number; total: number; cost: number }>;
}> {
  const period = range(query);
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const totals = await c.query<{
      sales_count: number;
      subtotal: string;
      discount_total: string;
      tax_total: string;
      total: string;
    }>(
      `SELECT count(*)::int AS sales_count,
              COALESCE(sum(subtotal), 0)::text AS subtotal,
              COALESCE(sum(discount_total), 0)::text AS discount_total,
              COALESCE(sum(tax_total), 0)::text AS tax_total,
              COALESCE(sum(total), 0)::text AS total
         FROM sales
        WHERE company_id = $1 AND status = 'COMPLETADA' AND sold_at >= $2 AND sold_at < $3`,
      [companyId, period.from, period.to],
    );
    // Costo de lo vendido por día (cantidad × costo del producto), para la
    // segunda línea de la gráfica (Ingresos vs Costos) y la utilidad bruta.
    const daily = await c.query<{ day: string; sales_count: number; total: string; cost: string }>(
      `SELECT to_char(s.sold_at::date, 'YYYY-MM-DD') AS day,
              count(*)::int AS sales_count,
              sum(s.total)::text AS total,
              COALESCE(sum(sc.cost_total), 0)::text AS cost
         FROM sales s
         LEFT JOIN (
           SELECT si.sale_id, sum(si.quantity * p.cost) AS cost_total
             FROM sale_items si
             JOIN products p ON p.company_id = si.company_id AND p.id = si.product_id
            WHERE si.company_id = $1
            GROUP BY si.sale_id
         ) sc ON sc.sale_id = s.id
        WHERE s.company_id = $1 AND s.status = 'COMPLETADA' AND s.sold_at >= $2 AND s.sold_at < $3
        GROUP BY s.sold_at::date ORDER BY s.sold_at::date`,
      [companyId, period.from, period.to],
    );
    const row = totals.rows[0]!;
    const dailyRows = daily.rows.map((entry) => ({
      day: entry.day,
      salesCount: entry.sales_count,
      total: Number(entry.total),
      cost: Number(entry.cost),
    }));
    const totalCost = dailyRows.reduce((acc, entry) => acc + entry.cost, 0);
    return {
      from: period.from,
      to: period.to,
      salesCount: row.sales_count,
      subtotal: Number(row.subtotal),
      discountTotal: Number(row.discount_total),
      taxTotal: Number(row.tax_total),
      total: Number(row.total),
      totalCost,
      grossProfit: Number(row.total) - totalCost,
      daily: dailyRows,
    };
  });
}

export async function getTopProducts(
  ctx: AuthContext,
  companyId: string,
  query: DateRange & { limit: number },
): Promise<Array<{ productId: string; name: string; sku: string; quantity: number; revenue: number }>> {
  const period = range(query);
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const result = await c.query<{ product_id: string; product_name: string; product_sku: string; quantity: string; revenue: string }>(
      `SELECT si.product_id, si.product_name, si.product_sku,
              sum(si.quantity)::text AS quantity, sum(si.line_total)::text AS revenue
         FROM sale_items si
         JOIN sales s ON s.company_id = si.company_id AND s.id = si.sale_id
        WHERE si.company_id = $1 AND s.status = 'COMPLETADA' AND s.sold_at >= $2 AND s.sold_at < $3
        GROUP BY si.product_id, si.product_name, si.product_sku
        ORDER BY sum(si.quantity) DESC LIMIT $4`,
      [companyId, period.from, period.to, query.limit],
    );
    return result.rows.map((row) => ({
      productId: row.product_id,
      name: row.product_name,
      sku: row.product_sku,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    }));
  });
}

export async function getLowStock(
  ctx: AuthContext,
  companyId: string,
): Promise<Array<{ productId: string; sku: string; name: string; quantity: number; minStock: number }>> {
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const result = await c.query<{ id: string; sku: string; name: string; quantity: string; min_stock: string }>(
      `SELECT p.id, p.sku, p.name, COALESCE(s.quantity, 0)::text AS quantity, p.min_stock::text
         FROM products p
         LEFT JOIN inventory_stock s ON s.company_id = p.company_id AND s.product_id = p.id
        WHERE p.company_id = $1 AND p.is_active = true AND p.deleted_at IS NULL
          AND p.track_stock = true AND COALESCE(s.quantity, 0) <= p.min_stock
        ORDER BY COALESCE(s.quantity, 0) ASC, p.name ASC`,
      [companyId],
    );
    return result.rows.map((row) => ({
      productId: row.id,
      sku: row.sku,
      name: row.name,
      quantity: Number(row.quantity),
      minStock: Number(row.min_stock),
    }));
  });
}
