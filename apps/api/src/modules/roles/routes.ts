import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { AuthContext } from '../auth/service.js';
import { AppError } from '../../shared/errors.js';
import * as service from './service.js';
import {
  companyIdParamSchema,
  roleIdAndCompanyParamSchema,
  createRoleSchema,
  updateRoleSchema,
  setRolePermissionsSchema,
} from './schema.js';

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
  };
}

/** Empresa activa del JWT del usuario (rutas tenant). */
function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) {
    throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  }
  return cid;
}

export async function rolesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  // -------------------------------------------------- Catálogo de permisos
  // Cualquier usuario autenticado puede leer el catálogo global.

  app.get('/permissions', { preHandler: app.authenticate }, async (_req, reply) => {
    const items = await service.listPermissions(auth);
    reply.send({ data: items });
  });

  // -------------------------------------------------- Rutas tenant
  // El tenant administra los roles de SU empresa (company_id del JWT).

  app.get('/roles', { preHandler: app.authenticate }, async (req, reply) => {
    const items = await service.listRoles(auth, currentCompanyId(req));
    reply.send({ data: items });
  });

  app.post('/roles', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createRoleSchema.parse(req.body);
    const role = await service.createRole(auth, currentCompanyId(req), input, requestMeta(req));
    reply.status(201).send({ data: role });
  });

  app.get('/roles/:roleId', { preHandler: app.authenticate }, async (req, reply) => {
    const { roleId } = roleIdAndCompanyParamSchema.pick({ roleId: true }).parse(req.params);
    const role = await service.getRole(auth, currentCompanyId(req), roleId);
    reply.send({ data: role });
  });

  app.patch('/roles/:roleId', { preHandler: app.authenticate }, async (req, reply) => {
    const { roleId } = roleIdAndCompanyParamSchema.pick({ roleId: true }).parse(req.params);
    const input = updateRoleSchema.parse(req.body);
    const role = await service.updateRole(auth, currentCompanyId(req), roleId, input, requestMeta(req));
    reply.send({ data: role });
  });

  app.delete('/roles/:roleId', { preHandler: app.authenticate }, async (req, reply) => {
    const { roleId } = roleIdAndCompanyParamSchema.pick({ roleId: true }).parse(req.params);
    await service.deleteRole(auth, currentCompanyId(req), roleId, requestMeta(req));
    reply.status(204).send();
  });

  app.put('/roles/:roleId/permissions', { preHandler: app.authenticate }, async (req, reply) => {
    const { roleId } = roleIdAndCompanyParamSchema.pick({ roleId: true }).parse(req.params);
    const input = setRolePermissionsSchema.parse(req.body);
    const role = await service.setRolePermissions(
      auth, currentCompanyId(req), roleId, input, requestMeta(req),
    );
    reply.send({ data: role });
  });

  // -------------------------------------------------- Rutas plataforma
  // El platform admin opera sobre cualquier empresa explícita en la URL.

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/roles', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const items = await service.listRoles(auth, companyId);
    reply.send({ data: items });
  });

  app.post('/platform/companies/:companyId/roles', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createRoleSchema.parse(req.body);
    const role = await service.createRole(auth, companyId, input, requestMeta(req));
    reply.status(201).send({ data: role });
  });

  app.get('/platform/companies/:companyId/roles/:roleId', platformPre, async (req, reply) => {
    const { companyId, roleId } = roleIdAndCompanyParamSchema.parse(req.params);
    reply.send({ data: await service.getRole(auth, companyId, roleId) });
  });

  app.patch('/platform/companies/:companyId/roles/:roleId', platformPre, async (req, reply) => {
    const { companyId, roleId } = roleIdAndCompanyParamSchema.parse(req.params);
    const input = updateRoleSchema.parse(req.body);
    reply.send({ data: await service.updateRole(auth, companyId, roleId, input, requestMeta(req)) });
  });

  app.delete('/platform/companies/:companyId/roles/:roleId', platformPre, async (req, reply) => {
    const { companyId, roleId } = roleIdAndCompanyParamSchema.parse(req.params);
    await service.deleteRole(auth, companyId, roleId, requestMeta(req));
    reply.status(204).send();
  });

  app.put(
    '/platform/companies/:companyId/roles/:roleId/permissions',
    platformPre,
    async (req, reply) => {
      const { companyId, roleId } = roleIdAndCompanyParamSchema.parse(req.params);
      const input = setRolePermissionsSchema.parse(req.body);
      reply.send({
        data: await service.setRolePermissions(auth, companyId, roleId, input, requestMeta(req)),
      });
    },
  );
}