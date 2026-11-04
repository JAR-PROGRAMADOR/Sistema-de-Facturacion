import type { PoolClient } from 'pg';

export interface CustomerRow {
  id: string;
  company_id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `id, company_id, name, tax_id, email, phone, address, notes, is_active, created_at, updated_at`;

interface CustomerFilter {
  search?: string;
  active?: 'all' | 'active' | 'inactive';
}

function buildWhere(companyId: string, query: CustomerFilter): { where: string[]; args: unknown[] } {
  const where = ['company_id = $1'];
  const args: unknown[] = [companyId];

  if (query.search) {
    args.push(`%${query.search.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${args.length} OR lower(coalesce(tax_id, '')) LIKE $${args.length} OR lower(coalesce(email, '')) LIKE $${args.length})`);
  }

  if (query.active && query.active !== 'all') {
    args.push(query.active === 'active');
    where.push(`is_active = $${args.length}`);
  }

  return { where, args };
}

export async function listCustomers(
  c: PoolClient,
  companyId: string,
  query: CustomerFilter & { limit: number; offset: number },
): Promise<CustomerRow[]> {
  const { where, args } = buildWhere(companyId, query);
  const r = await c.query<CustomerRow>(
    `SELECT ${SELECT_COLS} FROM customers
      WHERE ${where.join(' AND ')}
      ORDER BY name ASC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, query.limit, query.offset],
  );
  return r.rows;
}

export async function countCustomers(
  c: PoolClient,
  companyId: string,
  query: CustomerFilter,
): Promise<number> {
  const { where, args } = buildWhere(companyId, query);
  const r = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM customers WHERE ${where.join(' AND ')}`,
    args,
  );
  return Number(r.rows[0]?.count ?? '0');
}

export async function findCustomerById(
  c: PoolClient,
  companyId: string,
  customerId: string,
): Promise<CustomerRow | null> {
  const r = await c.query<CustomerRow>(
    `SELECT ${SELECT_COLS} FROM customers WHERE company_id = $1 AND id = $2`,
    [companyId, customerId],
  );
  return r.rows[0] ?? null;
}

export async function insertCustomer(
  c: PoolClient,
  input: {
    id: string;
    companyId: string;
    name: string;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
    isActive?: boolean;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO customers (id, company_id, name, tax_id, email, phone, address, notes, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [input.id, input.companyId, input.name, input.taxId ?? null, input.email || null, input.phone ?? null, input.address ?? null, input.notes ?? null, input.isActive ?? true],
  );
}

export async function updateCustomer(
  c: PoolClient,
  companyId: string,
  customerId: string,
  patch: {
    name?: string;
    tax_id?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
    is_active?: boolean;
  },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [companyId, customerId];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    args.push(value);
    sets.push(`${key} = $${args.length}`);
  }

  if (sets.length === 0) return;
  await c.query(`UPDATE customers SET ${sets.join(', ')} WHERE company_id = $1 AND id = $2`, args);
}
