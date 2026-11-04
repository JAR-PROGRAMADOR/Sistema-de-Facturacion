import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import {
  companyIdParamSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from './schema.js';

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
  };
}

export async function companiesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  // ---------------------------------------------------------------- Plataforma
  // Todas exigen sesión + bandera de plataforma.

  app.post(
    '/platform/companies',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const input = createCompanySchema.parse(req.body);
      const company = await service.createCompany(auth, input, requestMeta(req));
      reply.status(201).send({
        data: {
          company: {
            id: company.id,
            name: company.name,
            legalName: company.legal_name,
            taxId: company.tax_id,
            country: company.country,
            currency: company.currency,
            locale: company.locale,
            timezone: company.timezone,
            status: company.status,
            createdAt: company.created_at,
            updatedAt: company.updated_at,
          },
          adminRoleId: company.adminRoleId,
          vendorRoleId: company.vendorRoleId,
          adminUserCreated: company.adminUserCreated,
          adminUserId: company.adminUserId,
        },
      });
    },
  );

  app.get(
    '/platform/companies',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const q = listCompaniesQuerySchema.parse(req.query);
      const result = await service.listCompanies(auth, q);
      reply.send({
        data: result.items,
        meta: { total: result.total, page: q.page, limit: q.limit },
      });
    },
  );

  app.get(
    '/platform/companies/:id',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const { id } = companyIdParamSchema.parse(req.params);
      const company = await service.getCompany(auth, id);
      reply.send({ data: company });
    },
  );

  app.patch(
    '/platform/companies/:id',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const { id } = companyIdParamSchema.parse(req.params);
      const input = updateCompanySchema.parse(req.body);
      const company = await service.updateCompany(auth, id, input, requestMeta(req));
      reply.send({ data: company });
    },
  );

  app.post(
    '/platform/companies/:id/suspend',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const { id } = companyIdParamSchema.parse(req.params);
      const company = await service.setCompanyStatus(auth, id, 'SUSPENDIDA', requestMeta(req));
      reply.send({ data: company });
    },
  );

  app.post(
    '/platform/companies/:id/activate',
    { preHandler: [app.authenticate, app.requirePlatform] },
    async (req, reply) => {
      const { id } = companyIdParamSchema.parse(req.params);
      const company = await service.setCompanyStatus(auth, id, 'ACTIVA', requestMeta(req));
      reply.send({ data: company });
    },
  );

  // ---------------------------------------------------------------- Tenant
  // Cualquier usuario autenticado lee la empresa en la que está trabajando.

  app.get('/companies/me', { preHandler: app.authenticate }, async (req, reply) => {
    const company = await service.getMyCompany(auth, {
      userId: req.user.sub,
      companyId: req.user.cid,
      platform: req.user.plat,
    });
    reply.send({ data: company });
  });
}