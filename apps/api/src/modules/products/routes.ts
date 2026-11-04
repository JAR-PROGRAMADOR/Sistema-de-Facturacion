import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import { createProductSchema, listProductsQuerySchema, productIdParamSchema, updateProductSchema } from './schema.js';

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

export async function productsRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/products', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listProductsQuerySchema.parse(req.query);
    const result = await service.listProducts(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/products', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createProductSchema.parse(req.body);
    const product = await service.createProduct(auth, currentCompanyId(req), input, requestMeta(req));
    reply.status(201).send({ data: product });
  });

  app.get('/products/:productId', { preHandler: app.authenticate }, async (req, reply) => {
    const { productId } = productIdParamSchema.parse(req.params);
    const product = await service.getProduct(auth, currentCompanyId(req), productId);
    reply.send({ data: product });
  });

  app.patch('/products/:productId', { preHandler: app.authenticate }, async (req, reply) => {
    const { productId } = productIdParamSchema.parse(req.params);
    const input = updateProductSchema.parse(req.body);
    const product = await service.updateProduct(auth, currentCompanyId(req), productId, input, requestMeta(req));
    reply.send({ data: product });
  });

  app.delete('/products/:productId', { preHandler: app.authenticate }, async (req, reply) => {
    const { productId } = productIdParamSchema.parse(req.params);
    await service.deleteProduct(auth, currentCompanyId(req), productId, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  const platformProductParams = z.object({ companyId: z.string().uuid(), productId: z.string().uuid() });
  const platformCompanyParam = platformProductParams.pick({ companyId: true });

  app.get('/platform/companies/:companyId/products', platformPre, async (req, reply) => {
    const { companyId } = platformCompanyParam.parse(req.params);
    const query = listProductsQuerySchema.parse(req.query);
    const result = await service.listProducts(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.get('/platform/companies/:companyId/products/:productId', platformPre, async (req, reply) => {
    const { companyId, productId } = platformProductParams.parse(req.params);
    reply.send({ data: await service.getProduct(auth, companyId, productId) });
  });

  app.post('/platform/companies/:companyId/products', platformPre, async (req, reply) => {
    const { companyId } = platformCompanyParam.parse(req.params);
    const input = createProductSchema.parse(req.body);
    reply.status(201).send({ data: await service.createProduct(auth, companyId, input, requestMeta(req)) });
  });

  app.patch('/platform/companies/:companyId/products/:productId', platformPre, async (req, reply) => {
    const { companyId, productId } = platformProductParams.parse(req.params);
    const input = updateProductSchema.parse(req.body);
    reply.send({ data: await service.updateProduct(auth, companyId, productId, input, requestMeta(req)) });
  });

  app.delete('/platform/companies/:companyId/products/:productId', platformPre, async (req, reply) => {
    const { companyId, productId } = platformProductParams.parse(req.params);
    await service.deleteProduct(auth, companyId, productId, requestMeta(req));
    reply.status(204).send();
  });
}
