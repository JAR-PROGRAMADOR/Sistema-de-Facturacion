import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import { cashSessionIdParamSchema, closeCashSessionSchema, createCashMovementSchema, openCashSessionSchema } from './schema.js';

const platformParams = z.object({ companyId: z.string().uuid(), cashSessionId: z.string().uuid() });
const companyIdParam = platformParams.pick({ companyId: true });

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function cashRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/cash-sessions/open', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({ data: await service.getOpenCashSession(auth, currentCompanyId(req), req.user.sub) });
  });

  app.post('/cash-sessions', { preHandler: app.authenticate }, async (req, reply) => {
    const input = openCashSessionSchema.parse(req.body);
    reply.status(201).send({ data: await service.openCashSession(auth, currentCompanyId(req), req.user.sub, input.openingAmount, requestMeta(req)) });
  });

  app.post('/cash-sessions/:cashSessionId/movements', { preHandler: app.authenticate }, async (req, reply) => {
    const { cashSessionId } = cashSessionIdParamSchema.parse(req.params);
    const input = createCashMovementSchema.parse(req.body);
    reply.status(201).send({ data: await service.createCashMovement(auth, currentCompanyId(req), req.user.sub, cashSessionId, input, requestMeta(req)) });
  });

  app.post('/cash-sessions/:cashSessionId/close', { preHandler: app.authenticate }, async (req, reply) => {
    const { cashSessionId } = cashSessionIdParamSchema.parse(req.params);
    const input = closeCashSessionSchema.parse(req.body);
    reply.send({ data: await service.closeCashSession(auth, currentCompanyId(req), req.user.sub, cashSessionId, input.closingAmountDeclared, requestMeta(req)) });
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/cash-sessions/open', platformPre, async (req, reply) => {
    const { companyId } = companyIdParam.parse(req.params);
    reply.send({ data: await service.getOpenCashSession(auth, companyId, req.user.sub) });
  });

  app.post('/platform/companies/:companyId/cash-sessions', platformPre, async (req, reply) => {
    const { companyId } = companyIdParam.parse(req.params);
    const input = openCashSessionSchema.parse(req.body);
    reply.status(201).send({ data: await service.openCashSession(auth, companyId, req.user.sub, input.openingAmount, requestMeta(req)) });
  });

  app.post('/platform/companies/:companyId/cash-sessions/:cashSessionId/movements', platformPre, async (req, reply) => {
    const { companyId, cashSessionId } = platformParams.parse(req.params);
    const input = createCashMovementSchema.parse(req.body);
    reply.status(201).send({ data: await service.createCashMovement(auth, companyId, req.user.sub, cashSessionId, input, requestMeta(req)) });
  });

  app.post('/platform/companies/:companyId/cash-sessions/:cashSessionId/close', platformPre, async (req, reply) => {
    const { companyId, cashSessionId } = platformParams.parse(req.params);
    const input = closeCashSessionSchema.parse(req.body);
    reply.send({ data: await service.closeCashSession(auth, companyId, req.user.sub, cashSessionId, input.closingAmountDeclared, requestMeta(req)) });
  });
}
