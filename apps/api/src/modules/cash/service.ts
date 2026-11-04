import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import type { CreateCashMovementInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

interface CashSessionRow {
  id: string;
  company_id: string;
  opened_by: string;
  opened_at: Date;
  opening_amount: string;
  closed_by: string | null;
  closed_at: Date | null;
  closing_amount_declared: string | null;
  closing_amount_expected: string | null;
  status: 'ABIERTA' | 'CERRADA';
}

const mapSession = (row: CashSessionRow) => ({
  ...row,
  opening_amount: Number(row.opening_amount),
  closing_amount_declared: row.closing_amount_declared === null ? null : Number(row.closing_amount_declared),
  closing_amount_expected: row.closing_amount_expected === null ? null : Number(row.closing_amount_expected),
});

export async function getOpenCashSession(
  ctx: AuthContext,
  companyId: string,
  userId: string,
): Promise<ReturnType<typeof mapSession> | null> {
  return withContext(ctx.pool, { companyId, userId }, async (c) => {
    const result = await c.query<CashSessionRow>(
      `SELECT id, company_id, opened_by, opened_at, opening_amount::text, closed_by, closed_at,
              closing_amount_declared::text, closing_amount_expected::text, status
         FROM cash_sessions WHERE company_id = $1 AND opened_by = $2 AND status = 'ABIERTA'`,
      [companyId, userId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  });
}

export async function openCashSession(
  ctx: AuthContext,
  companyId: string,
  userId: string,
  openingAmount: number,
  meta: RequestMeta,
): Promise<ReturnType<typeof mapSession>> {
  const id = randomUUID();
  try {
    return await withContext(ctx.pool, { companyId, userId }, async (c) => {
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM cash_sessions WHERE company_id = $1 AND opened_by = $2 AND status = 'ABIERTA'`,
        [companyId, userId],
      );
      if (existing.rowCount) throw new AppError('CASH_SESSION_ALREADY_OPEN', 'Ya tienes un turno de caja abierto.', 409);

      const result = await c.query<CashSessionRow>(
        `INSERT INTO cash_sessions (id, company_id, opened_by, opening_amount)
         VALUES ($1,$2,$3,$4)
         RETURNING id, company_id, opened_by, opened_at, opening_amount::text, closed_by, closed_at,
                   closing_amount_declared::text, closing_amount_expected::text, status`,
        [id, companyId, userId, openingAmount],
      );
      await insertAudit(c, { companyId, userId, action: 'cash.opened', ip: meta.ip, metadata: { cashSessionId: id, openingAmount } });
      return mapSession(result.rows[0]!);
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError('CASH_SESSION_ALREADY_OPEN', 'Ya tienes un turno de caja abierto.', 409);
    }
    throw error;
  }
}

export async function createCashMovement(
  ctx: AuthContext,
  companyId: string,
  userId: string,
  cashSessionId: string,
  input: CreateCashMovementInput,
  meta: RequestMeta,
): Promise<{ id: string; type: 'INGRESO' | 'EGRESO'; amount: number; reason: string }> {
  return withContext(ctx.pool, { companyId, userId }, async (c) => {
    const session = await c.query<{ id: string }>(
      `SELECT id FROM cash_sessions WHERE company_id = $1 AND id = $2 AND opened_by = $3 AND status = 'ABIERTA' FOR UPDATE`,
      [companyId, cashSessionId, userId],
    );
    if (session.rowCount === 0) throw new AppError('CASH_SESSION_NOT_OPEN', 'El turno de caja no está abierto para este usuario.', 409);

    const id = randomUUID();
    await c.query(
      `INSERT INTO cash_movements (id, company_id, cash_session_id, type, amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, companyId, cashSessionId, input.type, input.amount, input.reason, userId],
    );
    await insertAudit(c, {
      companyId,
      userId,
      action: 'cash.movement_created',
      ip: meta.ip,
      metadata: { cashSessionId, movementId: id, type: input.type, amount: input.amount, reason: input.reason },
    });
    return { id, type: input.type, amount: input.amount, reason: input.reason };
  });
}

export async function closeCashSession(
  ctx: AuthContext,
  companyId: string,
  userId: string,
  cashSessionId: string,
  closingAmountDeclared: number,
  meta: RequestMeta,
): Promise<ReturnType<typeof mapSession>> {
  return withContext(ctx.pool, { companyId, userId }, async (c) => {
    const result = await c.query<CashSessionRow>(
      `SELECT id, company_id, opened_by, opened_at, opening_amount::text, closed_by, closed_at,
              closing_amount_declared::text, closing_amount_expected::text, status
         FROM cash_sessions WHERE company_id = $1 AND id = $2 AND opened_by = $3 FOR UPDATE`,
      [companyId, cashSessionId, userId],
    );
    const session = result.rows[0];
    if (!session) throw new AppError('CASH_SESSION_NOT_FOUND', 'El turno de caja no existe.', 404);
    if (session.status !== 'ABIERTA') throw new AppError('CASH_SESSION_CLOSED', 'El turno de caja ya está cerrado.', 409);

    const movements = await c.query<{ balance: string }>(
      `SELECT COALESCE(sum(CASE WHEN type = 'INGRESO' THEN amount ELSE -amount END), 0)::text AS balance
         FROM cash_movements WHERE company_id = $1 AND cash_session_id = $2`,
      [companyId, cashSessionId],
    );
    const expected = Number(session.opening_amount) + Number(movements.rows[0]?.balance ?? 0);

    const updated = await c.query<CashSessionRow>(
      `UPDATE cash_sessions SET status = 'CERRADA', closed_by = $3, closed_at = now(),
              closing_amount_declared = $4, closing_amount_expected = $5
        WHERE company_id = $1 AND id = $2
        RETURNING id, company_id, opened_by, opened_at, opening_amount::text, closed_by, closed_at,
                  closing_amount_declared::text, closing_amount_expected::text, status`,
      [companyId, cashSessionId, userId, closingAmountDeclared, expected],
    );
    await insertAudit(c, {
      companyId,
      userId,
      action: 'cash.closed',
      ip: meta.ip,
      metadata: { cashSessionId, closingAmountDeclared, closingAmountExpected: expected, difference: closingAmountDeclared - expected },
    });
    return mapSession(updated.rows[0]!);
  });
}
