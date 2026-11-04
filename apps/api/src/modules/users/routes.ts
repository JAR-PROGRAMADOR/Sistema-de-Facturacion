import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import {
  companyIdParamSchema,
  userIdAndCompanyParamSchema,
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
} from './schema.js';

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

const userIdParamSchema = userIdAndCompanyParamSchema.pick({ userId: true });

export async function usersRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  // ---------------------------------------------------------------- Tenant
  app.get('/users', { preHandler: app.authenticate }, async (req, reply) => {
    const q = listUsersQuerySchema.parse(req.query);
    const result = await service.listUsers(auth, currentCompanyId(req), q);
    reply.send({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  });

  app.post('/users', { preHandler: app.authenticate }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const payload = typeof body.roleId === 'string' && !('roleIds' in body)
      ? { ...body, roleIds: [body.roleId] }
      : body;
    const input = createUserSchema.parse(payload);
    const user = await service.createUser(auth, currentCompanyId(req), input, requestMeta(req));
    reply.status(201).send({
      data: {
        ...user,
        user_id: user.id,
        role_name: user.roles[0]?.name ?? null,
        role_id: user.roles[0]?.id ?? null,
      },
    });
  });

  app.get('/users/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const { userId } = userIdParamSchema.parse(req.params);
    reply.send({ data: await service.getUser(auth, currentCompanyId(req), userId) });
  });

  app.patch('/users/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    reply.send({
      data: await service.updateUser(auth, currentCompanyId(req), userId, input, requestMeta(req)),
    });
  });

  app.delete('/users/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const { userId } = userIdParamSchema.parse(req.params);
    await service.deactivateUser(auth, currentCompanyId(req), userId, requestMeta(req));
    reply.status(204).send();
  });

  // ---------------------------------------------------------------- Platform
  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/users', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const q = listUsersQuerySchema.parse(req.query);
    const result = await service.listUsers(auth, companyId, q);
    reply.send({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  });

  app.post('/platform/companies/:companyId/users', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const body = req.body as Record<string, unknown>;
    const payload = typeof body.roleId === 'string' && !('roleIds' in body)
      ? { ...body, roleIds: [body.roleId] }
      : body;
    const input = createUserSchema.parse(payload);
    const user = await service.createUser(auth, companyId, input, requestMeta(req));
    reply.status(201).send({
      data: {
        ...user,
        user_id: user.id,
        role_name: user.roles[0]?.name ?? null,
        role_id: user.roles[0]?.id ?? null,
      },
    });
  });

  app.get('/platform/companies/:companyId/users/:userId', platformPre, async (req, reply) => {
    const { companyId, userId } = userIdAndCompanyParamSchema.parse(req.params);
    reply.send({ data: await service.getUser(auth, companyId, userId) });
  });

  app.patch('/platform/companies/:companyId/users/:userId', platformPre, async (req, reply) => {
    const { companyId, userId } = userIdAndCompanyParamSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    reply.send({
      data: await service.updateUser(auth, companyId, userId, input, requestMeta(req)),
    });
  });

  app.delete('/platform/companies/:companyId/users/:userId', platformPre, async (req, reply) => {
    const { companyId, userId } = userIdAndCompanyParamSchema.parse(req.params);
    await service.deactivateUser(auth, companyId, userId, requestMeta(req));
    reply.status(204).send();
  });
}