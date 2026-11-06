import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requirePlatform } from '../../plugins/authorize.js';
import * as service from './service.js';
import {
  createLicenseSchema,
  createRegistrationLicenseSchema,
  createUserLicenseSchema,
  redeemLicenseSchema,
} from './schema.js';

export async function licensesRoutes(app: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;

  // ---------------------------------------------------------------- plataforma

  app.post('/platform/licenses', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const input = createLicenseSchema.parse(req.body);
    const data = await service.createLicense(pool, req.user.sub, input);
    reply.status(201).send({
      data: {
        id: data.id,
        key: data.key,
        durationSeconds: data.durationSeconds,
        warning: 'Guarda esta clave ahora: no se podrá volver a mostrar.',
      },
    });
  });

  app.post('/platform/user-licenses', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const input = createUserLicenseSchema.parse(req.body);
    const data = await service.createUserLicense(pool, req.user.sub, input);
    reply.status(201).send({
      data: {
        id: data.id,
        key: data.key,
        durationSeconds: data.durationSeconds,
        warning: 'Guarda esta clave ahora: no se podrá volver a mostrar.',
      },
    });
  });

  app.post('/platform/registration-licenses', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const input = createRegistrationLicenseSchema.parse(req.body);
    const data = await service.createRegistrationLicense(pool, req.user.sub, input);
    reply.status(201).send({
      data: {
        id: data.id,
        key: data.key,
        durationSeconds: data.durationSeconds,
        maxUsers: data.maxUsers,
        warning: 'Guarda esta clave ahora: no se podrá volver a mostrar.',
      },
    });
  });

  app.get('/platform/companies/:companyId/licenses', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const data = await service.listCompanyLicenses(pool, companyId);
    reply.send({ data });
  });

  app.get('/platform/companies/:companyId/users/:userId/licenses', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { companyId, userId } = req.params as { companyId: string; userId: string };
    const data = await service.listUserLicenses(pool, companyId, userId);
    reply.send({ data });
  });

  app.post('/platform/licenses/:id/suspend', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setLicenseStatus(pool, id, 'SUSPENDIDA');
    reply.send({ data });
  });

  app.post('/platform/licenses/:id/revoke', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setLicenseStatus(pool, id, 'REVOCADA');
    reply.send({ data });
  });

  app.post('/platform/licenses/:id/reactivate', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setLicenseStatus(pool, id, 'ACTIVA');
    reply.send({ data });
  });

  app.post('/platform/user-licenses/:id/suspend', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setUserLicenseStatus(pool, id, 'SUSPENDIDA');
    reply.send({ data });
  });

  app.post('/platform/user-licenses/:id/revoke', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setUserLicenseStatus(pool, id, 'REVOCADA');
    reply.send({ data });
  });

  app.post('/platform/user-licenses/:id/reactivate', { preHandler: [app.authenticate, requirePlatform()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await service.setUserLicenseStatus(pool, id, 'ACTIVA');
    reply.send({ data });
  });

  // ---------------------------------------------------------------- empresa

  // Sin exigir permiso ni licencia activa: es justo la pantalla para resolver una licencia
  // vencida o pendiente de canjear.
  app.get('/license-status', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await service.getLicenseStatus(pool, { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat });
    reply.send({ data });
  });

  app.post('/licenses/redeem', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user.plat || !req.user.cid) {
      return reply.status(400).send({
        error: { code: 'NO_COMPANY_CONTEXT', message: 'Esta acción requiere una sesión con una empresa activa.' },
      });
    }
    const input = redeemLicenseSchema.parse(req.body);
    const data = await service.redeemCompanyLicense(pool, { userId: req.user.sub, companyId: req.user.cid }, input.key);
    reply.send({ data });
  });

  app.post('/licenses/activate', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user.plat || !req.user.cid) {
      return reply.status(400).send({
        error: { code: 'NO_COMPANY_CONTEXT', message: 'Esta acción requiere una sesión con una empresa activa.' },
      });
    }
    const input = redeemLicenseSchema.parse(req.body);
    const data = await service.activateLicense(pool, { userId: req.user.sub, companyId: req.user.cid }, input.key);
    reply.send({ data });
  });

  app.post('/user-licenses/redeem', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user.plat || !req.user.cid) {
      return reply.status(400).send({
        error: { code: 'NO_COMPANY_CONTEXT', message: 'Esta acción requiere una sesión con una empresa activa.' },
      });
    }
    const input = redeemLicenseSchema.parse(req.body);
    const data = await service.redeemUserLicense(pool, { userId: req.user.sub, companyId: req.user.cid }, input.key);
    reply.send({ data });
  });
}
