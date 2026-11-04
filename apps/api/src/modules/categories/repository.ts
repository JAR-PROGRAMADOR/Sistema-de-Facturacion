import type { PoolClient } from 'pg';

export interface CategoryRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `id, company_id, name, description, is_active, created_at, updated_at`;

export async function listCategories(
  c: PoolClient,
  companyId: string,
  q: { limit: number; offset: number; search?: string; active?: 'all' | 'active' | 'inactive' },
): Promise<CategoryRow[]> {
  const where: string[] = ['company_id = $1'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`lower(name) LIKE $${args.length}`);
  }

  if (q.active && q.active !== 'all') {
    args.push(q.active === 'active');
    where.push(`is_active = $${args.length}`);
  }

  const r = await c.query<CategoryRow>(
    `SELECT ${SELECT_COLS} FROM categories
      WHERE ${where.join(' AND ')}
      ORDER BY name ASC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, q.limit, q.offset],
  );

  return r.rows;
}

export async function countCategories(
  c: PoolClient,
  companyId: string,
  q: { search?: string; active?: 'all' | 'active' | 'inactive' },
): Promise<number> {
  const where: string[] = ['company_id = $1'];
  const args: unknown[] = [companyId];

  if (q.search) {
    args.push(`%${q.search.toLowerCase()}%`);
    where.push(`lower(name) LIKE $${args.length}`);
  }

  if (q.active && q.active !== 'all') {
    args.push(q.active === 'active');
    where.push(`is_active = $${args.length}`);
  }

  const r = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM categories WHERE ${where.join(' AND ')}`,
    args,
  );

  return Number(r.rows[0]?.count ?? '0');
}

export async function findCategoryById(
  c: PoolClient,
  companyId: string,
  id: string,
): Promise<CategoryRow | null> {
  const r = await c.query<CategoryRow>(
    `SELECT ${SELECT_COLS} FROM categories WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );

  return r.rows[0] ?? null;
}

export async function categoryNameExists(
  c: PoolClient,
  companyId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const r = await c.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM categories
      WHERE company_id = $1 AND lower(name) = lower($2)
      ${excludeId ? 'AND id <> $3' : ''}
    ) AS exists`,
    excludeId ? [companyId, name, excludeId] : [companyId, name],
  );

  return Boolean(r.rows[0]?.exists);
}

export async function insertCategory(
  c: PoolClient,
  input: { id: string; companyId: string; name: string; description?: string | null; isActive?: boolean },
): Promise<void> {
  await c.query(
    `INSERT INTO categories (id, company_id, name, description, is_active)
      VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.companyId, input.name, input.description ?? null, input.isActive ?? true],
  );
}

export async function updateCategory(
  c: PoolClient,
  companyId: string,
  id: string,
  patch: { name?: string; description?: string | null; is_active?: boolean },
): Promise<void> {
  const entries: string[] = [];
  const args: unknown[] = [companyId, id];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    args.push(value);
    entries.push(`${key} = $${args.length}`);
  }

  if (entries.length === 0) return;

  await c.query(
    `UPDATE categories SET ${entries.join(', ')} WHERE company_id = $1 AND id = $2`,
    args,
  );
}

export async function deleteCategory(
  c: PoolClient,
  companyId: string,
  id: string,
): Promise<void> {
  await c.query(`DELETE FROM categories WHERE company_id = $1 AND id = $2`, [companyId, id]);
}
