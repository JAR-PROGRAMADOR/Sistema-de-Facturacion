import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import { adjustInventorySchema, listInventoryQuerySchema } from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) {
    throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  }
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
  };
}

export async function inventoryRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/inventory', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listInventoryQuerySchema.parse(req.query);
    const result = await service.listInventory(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.get('/inventory/:productId', { preHandler: app.authenticate }, async (req, reply) => {
    const { productId } = req.params as { productId: string };
    const stock = await service.getStock(auth, currentCompanyId(req), productId);
    reply.send({ data: stock });
  });

  app.post('/inventory/adjust', { preHandler: app.authenticate }, async (req, reply) => {
    const input = adjustInventorySchema.parse(req.body);
    const result = await service.applyInventoryAdjustment(auth, currentCompanyId(req), input, requestMeta(req), req.user.sub);
    reply.status(201).send({ data: result });
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  const platformParams = z.object({ companyId: z.string().uuid(), productId: z.string().uuid() });
  const platformCompany = platformParams.pick({ companyId: true });

  app.get('/platform/companies/:companyId/inventory', platformPre, async (req, reply) => {
    const { companyId } = platformCompany.parse(req.params);
    const query = listInventoryQuerySchema.parse(req.query);
    const result = await service.listInventory(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.get('/platform/companies/:companyId/inventory/:productId', platformPre, async (req, reply) => {
    const { companyId, productId } = platformParams.parse(req.params);
    reply.send({ data: await service.getStock(auth, companyId, productId) });
  });

  app.post('/platform/companies/:companyId/inventory/adjust', platformPre, async (req, reply) => {
    const { companyId } = platformCompany.parse(req.params);
    const input = adjustInventorySchema.parse(req.body);
    const result = await service.applyInventoryAdjustment(auth, companyId, input, requestMeta(req), req.user.sub);
    reply.status(201).send({ data: result });
  });
}
