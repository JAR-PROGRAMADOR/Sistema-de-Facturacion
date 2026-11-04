import type { PoolClient } from 'pg';

export interface InventoryRow {
  company_id: string;
  product_id: string;
  quantity: number;
  updated_at: Date;
}

export interface InventoryMovementRow {
  id: string;
  company_id: string;
  product_id: string;
  type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
  quantity: number;
  stock_after: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string;
  created_at: Date;
}

export async function findInventoryByProduct(
  c: PoolClient,
  companyId: string,
  productId: string,
): Promise<InventoryRow | null> {
  const r = await c.query<InventoryRow>(
    `SELECT company_id, product_id, quantity, updated_at
      FROM inventory_stock
      WHERE company_id = $1 AND product_id = $2`,
    [companyId, productId],
  );

  return r.rows[0] ?? null;
}

export async function upsertInventoryStock(
  c: PoolClient,
  companyId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  await c.query(
    `INSERT INTO inventory_stock (company_id, product_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (product_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [companyId, productId, quantity],
  );
}

export async function addMovement(
  c: PoolClient,
  input: {
    companyId: string;
    productId: string;
    type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
    quantity: number;
    stockAfter: number;
    reason?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    createdBy: string;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO inventory_movements (
      id, company_id, product_id, type, quantity, stock_after, reason,
      reference_type, reference_id, created_by
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.companyId,
      input.productId,
      input.type,
      input.quantity,
      input.stockAfter,
      input.reason ?? null,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.createdBy,
    ],
  );
}

export async function listInventory(
  c: PoolClient,
  companyId: string,
  q: { limit: number; offset: number; search?: string; categoryId?: string },
): Promise<Array<{ product_id: string; sku: string; name: string; category_id: string | null; quantity: number; min_stock: number; track_stock: boolean; is_active: boolean; category_name: string | null }>> {
  const where: string[] = ['p.company_id = $1'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(p.name) LIKE $${args.length} OR lower(p.sku) LIKE $${args.length})`);
  }

  if (q.categoryId) {
    args.push(q.categoryId);
    where.push(`p.category_id = $${args.length}`);
  }

  const r = await c.query<{
    product_id: string; sku: string; name: string; category_id: string | null; quantity: number; min_stock: number; track_stock: boolean; is_active: boolean; category_name: string | null;
  }>(
    `SELECT p.id AS product_id, p.sku, p.name, p.category_id, COALESCE(s.quantity, 0) AS quantity,
            p.min_stock, p.track_stock, p.is_active, c.name AS category_name
      FROM products p
      LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.company_id = p.company_id
      LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
      WHERE ${where.join(' AND ')} AND p.deleted_at IS NULL
      ORDER BY p.name ASC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, q.limit, q.offset],
  );

  return r.rows;
}

export async function countInventory(
  c: PoolClient,
  companyId: string,
  q: { search?: string; categoryId?: string },
): Promise<number> {
  const where: string[] = ['p.company_id = $1'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(p.name) LIKE $${args.length} OR lower(p.sku) LIKE $${args.length})`);
  }

  if (q.categoryId) {
    args.push(q.categoryId);
    where.push(`p.category_id = $${args.length}`);
  }

  const r = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM products p WHERE ${where.join(' AND ')} AND p.deleted_at IS NULL`,
    args,
  );

  return Number(r.rows[0]?.count ?? '0');
}
