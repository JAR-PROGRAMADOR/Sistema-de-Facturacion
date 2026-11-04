import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import { auditQuerySchema, companyIdParamSchema } from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

export async function auditRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;
  app.get('/audit-logs', { preHandler: app.authenticate }, async (req, reply) => {
    const query = auditQuerySchema.parse(req.query);
    const result = await service.listAuditLogs(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  app.get('/platform/companies/:companyId/audit-logs', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = auditQuerySchema.parse(req.query);
    const result = await service.listAuditLogs(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });
}
