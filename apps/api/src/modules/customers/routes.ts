import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import { createCustomerSchema, customerIdParamSchema, listCustomersQuerySchema, updateCustomerSchema } from './schema.js';

const platformCustomerParams = z.object({ companyId: z.string().uuid(), customerId: z.string().uuid() });
const companyIdParamSchema = platformCustomerParams.pick({ companyId: true });

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function customersRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/customers', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listCustomersQuerySchema.parse(req.query);
    const result = await service.listCustomers(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/customers', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createCustomerSchema.parse(req.body);
    const customer = await service.createCustomer(auth, currentCompanyId(req), input, requestMeta(req));
    reply.status(201).send({ data: customer });
  });

  app.get('/customers/:customerId', { preHandler: app.authenticate }, async (req, reply) => {
    const { customerId } = customerIdParamSchema.parse(req.params);
    reply.send({ data: await service.getCustomer(auth, currentCompanyId(req), customerId) });
  });

  app.patch('/customers/:customerId', { preHandler: app.authenticate }, async (req, reply) => {
    const { customerId } = customerIdParamSchema.parse(req.params);
    const input = updateCustomerSchema.parse(req.body);
    reply.send({ data: await service.updateCustomer(auth, currentCompanyId(req), customerId, input, requestMeta(req)) });
  });

  app.delete('/customers/:customerId', { preHandler: app.authenticate }, async (req, reply) => {
    const { customerId } = customerIdParamSchema.parse(req.params);
    await service.deactivateCustomer(auth, currentCompanyId(req), customerId, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/customers', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const query = listCustomersQuerySchema.parse(req.query);
    const result = await service.listCustomers(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.post('/platform/companies/:companyId/customers', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createCustomerSchema.parse(req.body);
    reply.status(201).send({ data: await service.createCustomer(auth, companyId, input, requestMeta(req)) });
  });

  app.get('/platform/companies/:companyId/customers/:customerId', platformPre, async (req, reply) => {
    const { companyId, customerId } = platformCustomerParams.parse(req.params);
    reply.send({ data: await service.getCustomer(auth, companyId, customerId) });
  });

  app.patch('/platform/companies/:companyId/customers/:customerId', platformPre, async (req, reply) => {
    const { companyId, customerId } = platformCustomerParams.parse(req.params);
    const input = updateCustomerSchema.parse(req.body);
    reply.send({ data: await service.updateCustomer(auth, companyId, customerId, input, requestMeta(req)) });
  });

  app.delete('/platform/companies/:companyId/customers/:customerId', platformPre, async (req, reply) => {
    const { companyId, customerId } = platformCustomerParams.parse(req.params);
    await service.deactivateCustomer(auth, companyId, customerId, requestMeta(req));
    reply.status(204).send();
  });
}
