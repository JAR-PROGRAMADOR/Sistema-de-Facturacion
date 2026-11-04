import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../database/client.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as companiesService from '../companies/service.js';
import * as cashService from './service.js';

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

describe.skipIf(!enabled)('Módulo de caja', () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let ctx: AuthContext;
  let companyId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    appPool = createPool(process.env.DATABASE_URL!);
    ctx = { pool: appPool, env: testEnv, signAccessToken: () => 'test-token' };
    const company = await companiesService.createCompany(
      ctx,
      { name: 'Caja Test', currency: 'USD', locale: 'es', timezone: 'UTC' },
      { ip: null, userAgent: null },
    );
    companyId = company.id;
  });

  afterAll(async () => {
    if (companyId) {
      await admin.query(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM cash_movements WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM cash_sessions WHERE company_id = $1`, [companyId]);
      await admin.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }
    await appPool.end();
    await admin.end();
  });

  it('abre caja, registra movimiento y calcula el cierre esperado', async () => {
    const session = await cashService.openCashSession(ctx, companyId, actorId, 50, { ip: null, userAgent: null });
    await cashService.createCashMovement(ctx, companyId, actorId, session.id, { type: 'INGRESO', amount: 10, reason: 'Fondo adicional' }, { ip: null, userAgent: null });
    const closed = await cashService.closeCashSession(ctx, companyId, actorId, session.id, 62, { ip: null, userAgent: null });

    expect(closed.status).toBe('CERRADA');
    expect(closed.closing_amount_expected).toBe(60);
    expect(closed.closing_amount_declared).toBe(62);
  });

  it('no permite más de una caja abierta por cajero', async () => {
    await cashService.openCashSession(ctx, companyId, actorId, 0, { ip: null, userAgent: null });
    await expect(cashService.openCashSession(ctx, companyId, actorId, 0, { ip: null, userAgent: null }))
      .rejects.toMatchObject({ code: 'CASH_SESSION_ALREADY_OPEN' });
  });
});
