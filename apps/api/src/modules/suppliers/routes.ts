import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import { createSupplierSchema, listSuppliersQuerySchema, supplierIdParamSchema, updateSupplierSchema } from './schema.js';

const platformSupplierParams = z.object({ companyId: z.string().uuid(), supplierId: z.string().uuid() });
const companyIdParamSchema = platformSupplierParams.pick({ companyId: true });

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function suppliersRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/suppliers', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listSuppliersQuerySchema.parse(req.query);
    const result = await service.listSuppliers(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/suppliers', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createSupplierSchema.parse(req.body);
    reply.status(201).send({ data: await service.createSupplier(auth, currentCompanyId(req), input, requestMeta(req)) });
  });

  app.get('/suppliers/:supplierId', { preHandler: app.authenticate }, async (req, reply) => {
    const { supplierId } = supplierIdParamSchema.parse(req.params);
    reply.send({ data: await service.getSupplier(auth, currentCompanyId(req), supplierId) });
  });

  app.patch('/suppliers/:supplierId', { preHandler: app.authenticate }, async (req, reply) => {
    const { supplierId } = supplierIdParamSchema.parse(req.params);
    const input = updateSupplierSchema.parse(req.body);
    reply.send({ data: await service.updateSupplier(auth, currentCompanyId(req), supplierId, input, requestMeta(req)) });
  });

  app.delete('/suppliers/:supplierId', { preHandler: app.authenticate }, async (req, reply) => {
    const { supplierId } = supplierIdParamSchema.parse(req.params);
    await service.deactivateSupplier(auth, currentCompanyId(req), supplierId, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/suppliers', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = listSuppliersQuerySchema.parse(req.query);
    const result = await service.listSuppliers(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/platform/companies/:companyId/suppliers', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createSupplierSchema.parse(req.body);
    reply.status(201).send({ data: await service.createSupplier(auth, companyId, input, requestMeta(req)) });
  });

  app.get('/platform/companies/:companyId/suppliers/:supplierId', platformPre, async (req, reply) => {
    const { companyId, supplierId } = platformSupplierParams.parse(req.params);
    reply.send({ data: await service.getSupplier(auth, companyId, supplierId) });
  });

  app.patch('/platform/companies/:companyId/suppliers/:supplierId', platformPre, async (req, reply) => {
    const { companyId, supplierId } = platformSupplierParams.parse(req.params);
    const input = updateSupplierSchema.parse(req.body);
    reply.send({ data: await service.updateSupplier(auth, companyId, supplierId, input, requestMeta(req)) });
  });

  app.delete('/platform/companies/:companyId/suppliers/:supplierId', platformPre, async (req, reply) => {
    const { companyId, supplierId } = platformSupplierParams.parse(req.params);
    await service.deactivateSupplier(auth, companyId, supplierId, requestMeta(req));
    reply.status(204).send();
  });
}
