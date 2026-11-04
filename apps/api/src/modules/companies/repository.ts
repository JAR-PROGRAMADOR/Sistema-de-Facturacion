import type { PoolClient } from 'pg';

export interface CompanyRow {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  country: string | null;
  currency: string;
  locale: string;
  timezone: string;
  status: 'ACTIVA' | 'SUSPENDIDA';
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `id, name, legal_name, tax_id, country, currency, locale, timezone, status, created_at, updated_at`;

export async function insertCompany(
  c: PoolClient,
  p: { id: string; name: string; legalName: string | null; taxId: string | null;
       country: string | null; currency: string; locale: string; timezone: string },
): Promise<void> {
  await c.query(
    `INSERT INTO companies (id, name, legal_name, tax_id, country, currency, locale, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [p.id, p.name, p.legalName, p.taxId, p.country, p.currency, p.locale, p.timezone],
  );
}

export async function findCompanyById(c: PoolClient, id: string): Promise<CompanyRow | null> {
  const r = await c.query<CompanyRow>(`SELECT ${SELECT_COLS} FROM companies WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function listCompanies(
  c: PoolClient,
  q: { limit: number; offset: number; search?: string; status?: 'ACTIVA' | 'SUSPENDIDA' },
): Promise<CompanyRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.search) { args.push(`%${q.search.toLowerCase()}%`); where.push(`lower(name) LIKE $${args.length}`); }
  if (q.status) { args.push(q.status); where.push(`status = $${args.length}`); }
  args.push(q.limit, q.offset);
  const r = await c.query<CompanyRow>(
    `SELECT ${SELECT_COLS} FROM companies
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return r.rows;
}

export async function countCompanies(
  c: PoolClient,
  q: { search?: string; status?: 'ACTIVA' | 'SUSPENDIDA' },
): Promise<number> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.search) { args.push(`%${q.search.toLowerCase()}%`); where.push(`lower(name) LIKE $${args.length}`); }
  if (q.status) { args.push(q.status); where.push(`status = $${args.length}`); }
  const r = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM companies ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    args,
  );
  return Number(r.rows[0]?.count ?? '0');
}

export async function updateCompany(
  c: PoolClient,
  id: string,
  patch: Partial<Pick<CompanyRow, 'name'|'legal_name'|'tax_id'|'country'|'currency'|'locale'|'timezone'|'status'>>,
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    args.push(v);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) return;
  await c.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $1`, args);
}

export async function setCompanyStatus(
  c: PoolClient,
  id: string,
  status: 'ACTIVA' | 'SUSPENDIDA',
): Promise<void> {
  await c.query('UPDATE companies SET status = $2 WHERE id = $1', [id, status]);
}