import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import { companyIdParamSchema, dateRangeQuerySchema, topProductsQuerySchema } from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

export async function reportsRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/reports/sales-summary', { preHandler: app.authenticate }, async (req, reply) => {
    const query = dateRangeQuerySchema.parse(req.query);
    reply.send({ data: await service.getSalesSummary(auth, currentCompanyId(req), query) });
  });

  app.get('/reports/top-products', { preHandler: app.authenticate }, async (req, reply) => {
    const query = topProductsQuerySchema.parse(req.query);
    reply.send({ data: await service.getTopProducts(auth, currentCompanyId(req), query) });
  });

  app.get('/reports/low-stock', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({ data: await service.getLowStock(auth, currentCompanyId(req)) });
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/reports/sales-summary', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = dateRangeQuerySchema.parse(req.query);
    reply.send({ data: await service.getSalesSummary(auth, companyId, query) });
  });

  app.get('/platform/companies/:companyId/reports/top-products', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = topProductsQuerySchema.parse(req.query);
    reply.send({ data: await service.getTopProducts(auth, companyId, query) });
  });

  app.get('/platform/companies/:companyId/reports/low-stock', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    reply.send({ data: await service.getLowStock(auth, companyId) });
  });
}
