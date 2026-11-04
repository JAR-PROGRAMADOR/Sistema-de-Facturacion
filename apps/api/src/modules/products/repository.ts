import type { PoolClient } from 'pg';

export interface ProductRow {
  id: string;
  company_id: string;
  category_id: string | null;
  tax_rate_id: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  type: 'BIEN' | 'SERVICIO';
  price: number;
  cost: number | null;
  track_stock: boolean;
  min_stock: number;
  is_active: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `id, company_id, category_id, tax_rate_id, sku, barcode, name, description, type, price, cost, track_stock, min_stock, is_active, deleted_at, created_at, updated_at`;

export async function listProducts(
  c: PoolClient,
  companyId: string,
  q: { limit: number; offset: number; search?: string; categoryId?: string; active?: 'all' | 'active' | 'inactive' },
): Promise<ProductRow[]> {
  const where: string[] = ['company_id = $1', 'deleted_at IS NULL'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${args.length} OR lower(sku) LIKE $${args.length})`);
  }

  if (q.categoryId) {
    args.push(q.categoryId);
    where.push(`category_id = $${args.length}`);
  }

  if (q.active && q.active !== 'all') {
    args.push(q.active === 'active');
    where.push(`is_active = $${args.length}`);
  }

  const r = await c.query<ProductRow>(
    `SELECT ${SELECT_COLS} FROM products
      WHERE ${where.join(' AND ')}
      ORDER BY name ASC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, q.limit, q.offset],
  );

  return r.rows;
}

export async function countProducts(
  c: PoolClient,
  companyId: string,
  q: { search?: string; categoryId?: string; active?: 'all' | 'active' | 'inactive' },
): Promise<number> {
  const where: string[] = ['company_id = $1', 'deleted_at IS NULL'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${args.length} OR lower(sku) LIKE $${args.length})`);
  }

  if (q.categoryId) {
    args.push(q.categoryId);
    where.push(`category_id = $${args.length}`);
  }

  if (q.active && q.active !== 'all') {
    args.push(q.active === 'active');
    where.push(`is_active = $${args.length}`);
  }

  const r = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM products WHERE ${where.join(' AND ')}`,
    args,
  );

  return Number(r.rows[0]?.count ?? '0');
}

export async function findProductById(
  c: PoolClient,
  companyId: string,
  productId: string,
): Promise<ProductRow | null> {
  const r = await c.query<ProductRow>(
    `SELECT ${SELECT_COLS} FROM products WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [companyId, productId],
  );

  return r.rows[0] ?? null;
}

export async function skuExists(
  c: PoolClient,
  companyId: string,
  sku: string,
  excludeId?: string,
): Promise<boolean> {
  const r = await c.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM products
      WHERE company_id = $1 AND lower(sku) = lower($2) AND deleted_at IS NULL
      ${excludeId ? 'AND id <> $3' : ''}
    ) AS exists`,
    excludeId ? [companyId, sku, excludeId] : [companyId, sku],
  );

  return Boolean(r.rows[0]?.exists);
}

export async function insertProduct(
  c: PoolClient,
  input: {
    id: string;
    companyId: string;
    categoryId?: string | null;
    taxRateId?: string | null;
    sku: string;
    barcode?: string | null;
    name: string;
    description?: string | null;
    type?: 'BIEN' | 'SERVICIO';
    price: number;
    cost?: number | null;
    trackStock?: boolean;
    minStock?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO products (
      id, company_id, category_id, tax_rate_id, sku, barcode, name, description, type,
      price, cost, track_stock, min_stock, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.id,
      input.companyId,
      input.categoryId ?? null,
      input.taxRateId ?? null,
      input.sku,
      input.barcode ?? null,
      input.name,
      input.description ?? null,
      input.type ?? 'BIEN',
      input.price,
      input.cost ?? null,
      input.trackStock ?? true,
      input.minStock ?? 0,
      input.isActive ?? true,
    ],
  );
}

export async function updateProduct(
  c: PoolClient,
  companyId: string,
  productId: string,
  patch: {
    category_id?: string | null;
    tax_rate_id?: string | null;
    sku?: string;
    barcode?: string | null;
    name?: string;
    description?: string | null;
    type?: 'BIEN' | 'SERVICIO';
    price?: number;
    cost?: number | null;
    track_stock?: boolean;
    min_stock?: number;
    is_active?: boolean;
  },
): Promise<void> {
  const entries: string[] = [];
  const args: unknown[] = [companyId, productId];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    args.push(value);
    entries.push(`${key} = $${args.length}`);
  }

  if (entries.length === 0) return;

  await c.query(
    `UPDATE products SET ${entries.join(', ')} WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
    args,
  );
}

export async function softDeleteProduct(
  c: PoolClient,
  companyId: string,
  productId: string,
): Promise<void> {
  await c.query(
    `UPDATE products SET deleted_at = now() WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [companyId, productId],
  );
}
