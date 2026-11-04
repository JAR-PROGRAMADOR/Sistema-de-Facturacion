import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import { cancelSaleSchema, companyIdParamSchema, createSaleSchema, listSalesQuerySchema, saleIdAndCompanyParamSchema, saleIdParamSchema } from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function salesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  async function listPaymentMethods(companyId: string) {
    return withPaymentContext(auth, companyId, async (c) => {
      const result = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id, code, name FROM payment_methods WHERE company_id = $1 AND is_active = true ORDER BY name`,
        [companyId],
      );
      return result.rows;
    });
  }

  app.get('/payment-methods', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({ data: await listPaymentMethods(currentCompanyId(req)) });
  });

  app.get('/sales', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listSalesQuerySchema.parse(req.query);
    const result = await service.listSales(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/sales', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createSaleSchema.parse(req.body);
    const sale = await service.createSale(auth, currentCompanyId(req), req.user.sub, input, requestMeta(req));
    reply.status(201).send({ data: sale });
  });

  app.post('/sales/:saleId/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const { saleId } = saleIdParamSchema.parse(req.params);
    const input = cancelSaleSchema.parse(req.body);
    await service.cancelSale(auth, currentCompanyId(req), saleId, req.user.sub, input, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/payment-methods', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    reply.send({ data: await listPaymentMethods(companyId) });
  });

  app.get('/platform/companies/:companyId/sales', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = listSalesQuerySchema.parse(req.query);
    const result = await service.listSales(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/platform/companies/:companyId/sales', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createSaleSchema.parse(req.body);
    const sale = await service.createSale(auth, companyId, req.user.sub, input, requestMeta(req));
    reply.status(201).send({ data: sale });
  });

  app.post('/platform/companies/:companyId/sales/:saleId/cancel', platformPre, async (req, reply) => {
    const { companyId, saleId } = saleIdAndCompanyParamSchema.parse(req.params);
    const input = cancelSaleSchema.parse(req.body);
    await service.cancelSale(auth, companyId, saleId, req.user.sub, input, requestMeta(req));
    reply.status(204).send();
  });
}

async function withPaymentContext<T>(
  auth: AuthContext,
  companyId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withContext(auth.pool, { platform: true, companyId }, fn);
}
