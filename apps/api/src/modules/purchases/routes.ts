import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  listPurchasesQuerySchema,
  purchaseIdParamSchema,
  purchaseIdCompanyParamsSchema,
  purchaseCompanyParamsSchema,
} from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function purchasesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/purchases', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listPurchasesQuerySchema.parse(req.query);
    const result = await service.listPurchases(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/purchases', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createPurchaseSchema.parse(req.body);
    const purchase = await service.createPurchase(auth, currentCompanyId(req), req.user.sub, input, requestMeta(req));
    reply.status(201).send({ data: purchase });
  });

  app.post('/purchases/:purchaseId/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const { purchaseId } = purchaseIdParamSchema.parse(req.params);
    const input = cancelPurchaseSchema.parse(req.body);
    await service.cancelPurchase(auth, currentCompanyId(req), purchaseId, req.user.sub, input.reason, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  app.get('/platform/companies/:companyId/purchases', platformPre, async (req, reply) => {
    const { companyId } = purchaseCompanyParamsSchema.parse(req.params);
    const query = listPurchasesQuerySchema.parse(req.query);
    const result = await service.listPurchases(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/platform/companies/:companyId/purchases', platformPre, async (req, reply) => {
    const { companyId } = purchaseCompanyParamsSchema.parse(req.params);
    const input = createPurchaseSchema.parse(req.body);
    const purchase = await service.createPurchase(auth, companyId, req.user.sub, input, requestMeta(req));
    reply.status(201).send({ data: purchase });
  });

  app.post('/platform/companies/:companyId/purchases/:purchaseId/cancel', platformPre, async (req, reply) => {
    const { companyId, purchaseId } = purchaseIdCompanyParamsSchema.parse(req.params);
    const input = cancelPurchaseSchema.parse(req.body);
    await service.cancelPurchase(auth, companyId, purchaseId, req.user.sub, input.reason, requestMeta(req));
    reply.status(204).send();
  });
}
