import { withContext } from '../../database/client.js';
import type { AuthContext } from '../auth/service.js';
import type { AuditQuery } from './schema.js';

export interface AuditEntry {
  id: string;
  company_id: string | null;
  user_id: string | null;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  result: 'OK' | 'ERROR';
  ip: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export async function listAuditLogs(
  ctx: AuthContext,
  companyId: string,
  query: AuditQuery,
): Promise<{ items: AuditEntry[]; total: number; page: number; limit: number }> {
  const page = query.page;
  const limit = query.limit;
  const where: string[] = ['a.company_id = $1'];
  const args: unknown[] = [companyId];
  if (query.action) {
    args.push(`%${query.action.toLowerCase()}%`);
    where.push(`lower(a.action) LIKE $${args.length}`);
  }
  if (query.result) {
    args.push(query.result);
    where.push(`a.result = $${args.length}`);
  }
  if (query.from) {
    args.push(query.from);
    where.push(`a.created_at >= $${args.length}`);
  }
  if (query.to) {
    args.push(query.to);
    where.push(`a.created_at <= $${args.length}`);
  }

  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const rows = await c.query<AuditEntry>(
      `SELECT a.id::text, a.company_id, a.user_id, u.full_name AS user_name, a.action,
              a.resource_type, a.resource_id, a.result, a.ip, a.metadata, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, (page - 1) * limit],
    );
    const count = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs a WHERE ${where.join(' AND ')}`,
      args,
    );
    return { items: rows.rows, total: Number(count.rows[0]?.count ?? 0), page, limit };
  });
}
