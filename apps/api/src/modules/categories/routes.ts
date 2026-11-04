import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import { categoryIdParamSchema, createCategorySchema, listCategoriesQuerySchema, updateCategorySchema } from './schema.js';

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

export async function categoriesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/categories', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listCategoriesQuerySchema.parse(req.query);
    const result = await service.listCategories(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/categories', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createCategorySchema.parse(req.body);
    const category = await service.createCategory(auth, currentCompanyId(req), input, requestMeta(req));
    reply.status(201).send({ data: category });
  });

  app.get('/categories/:categoryId', { preHandler: app.authenticate }, async (req, reply) => {
    const { categoryId } = categoryIdParamSchema.parse(req.params);
    const category = await service.getCategory(auth, currentCompanyId(req), categoryId);
    reply.send({ data: category });
  });

  app.patch('/categories/:categoryId', { preHandler: app.authenticate }, async (req, reply) => {
    const { categoryId } = categoryIdParamSchema.parse(req.params);
    const input = updateCategorySchema.parse(req.body);
    const category = await service.updateCategory(auth, currentCompanyId(req), categoryId, input, requestMeta(req));
    reply.send({ data: category });
  });

  app.delete('/categories/:categoryId', { preHandler: app.authenticate }, async (req, reply) => {
    const { categoryId } = categoryIdParamSchema.parse(req.params);
    await service.deleteCategory(auth, currentCompanyId(req), categoryId, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  const platformParams = z.object({ companyId: z.string().uuid(), categoryId: z.string().uuid() });
  const platformCompany = platformParams.pick({ companyId: true });

  app.get('/platform/companies/:companyId/categories', platformPre, async (req, reply) => {
    const { companyId } = platformCompany.parse(req.params);
    const query = listCategoriesQuerySchema.parse(req.query);
    const result = await service.listCategories(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/platform/companies/:companyId/categories', platformPre, async (req, reply) => {
    const { companyId } = platformCompany.parse(req.params);
    const input = createCategorySchema.parse(req.body);
    reply.status(201).send({ data: await service.createCategory(auth, companyId, input, requestMeta(req)) });
  });

  app.get('/platform/companies/:companyId/categories/:categoryId', platformPre, async (req, reply) => {
    const { companyId, categoryId } = platformParams.parse(req.params);
    reply.send({ data: await service.getCategory(auth, companyId, categoryId) });
  });

  app.patch('/platform/companies/:companyId/categories/:categoryId', platformPre, async (req, reply) => {
    const { companyId, categoryId } = platformParams.parse(req.params);
    const input = updateCategorySchema.parse(req.body);
    reply.send({ data: await service.updateCategory(auth, companyId, categoryId, input, requestMeta(req)) });
  });

  app.delete('/platform/companies/:companyId/categories/:categoryId', platformPre, async (req, reply) => {
    const { companyId, categoryId } = platformParams.parse(req.params);
    await service.deleteCategory(auth, companyId, categoryId, requestMeta(req));
    reply.status(204).send();
  });
}
