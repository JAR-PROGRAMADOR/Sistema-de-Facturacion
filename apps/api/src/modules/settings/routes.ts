import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import * as catalogs from './catalogSettings.js';
import {
  companyIdParamSchema,
  createPaymentMethodSchema,
  createTaxRateSchema,
  paymentMethodIdParamsSchema,
  taxRateIdParamsSchema,
  updatePaymentMethodSchema,
  updateSettingsSchema,
  updateTaxRateSchema,
} from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function settingsRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/settings', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({ data: await service.getCompanySettings(auth, currentCompanyId(req)) });
  });

  app.patch('/settings', { preHandler: app.authenticate }, async (req, reply) => {
    const input = updateSettingsSchema.parse(req.body);
    reply.send({ data: await service.updateCompanySettings(auth, currentCompanyId(req), input, req.user.sub, requestMeta(req)) });
  });

  app.get('/tax-rates', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({ data: await catalogs.listTaxRates(auth, currentCompanyId(req)) });
  });

  app.post('/tax-rates', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createTaxRateSchema.parse(req.body);
    reply.status(201).send({ data: await catalogs.createTaxRate(auth, currentCompanyId(req), input, req.user.sub, requestMeta(req)) });
  });

  app.patch('/tax-rates/:taxRateId', { preHandler: app.authenticate }, async (req, reply) => {
    const { taxRateId } = taxRateIdParamsSchema.parse(req.params);
    const input = updateTaxRateSchema.parse(req.body);
    reply.send({ data: await catalogs.updateTaxRate(auth, currentCompanyId(req), taxRateId, input, req.user.sub, requestMeta(req)) });
  });

  app.post('/payment-methods', { preHandler: app.authenticate }, async (req, reply) => {
    const input = createPaymentMethodSchema.parse(req.body);
    reply.status(201).send({ data: await catalogs.createPaymentMethod(auth, currentCompanyId(req), input, req.user.sub, requestMeta(req)) });
  });

  app.patch('/payment-methods/:paymentMethodId', { preHandler: app.authenticate }, async (req, reply) => {
    const { paymentMethodId } = paymentMethodIdParamsSchema.parse(req.params);
    const input = updatePaymentMethodSchema.parse(req.body);
    reply.send({ data: await catalogs.updatePaymentMethod(auth, currentCompanyId(req), paymentMethodId, input, req.user.sub, requestMeta(req)) });
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };
  
  app.get('/platform/companies/:companyId/settings', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    reply.send({ data: await service.getCompanySettings(auth, companyId) });
  });

  app.patch('/platform/companies/:companyId/settings', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = updateSettingsSchema.parse(req.body);
    reply.send({ data: await service.updateCompanySettings(auth, companyId, input, req.user.sub, requestMeta(req)) });
  });

  app.get('/platform/companies/:companyId/tax-rates', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    reply.send({ data: await catalogs.listTaxRates(auth, companyId) });
  });

  app.post('/platform/companies/:companyId/tax-rates', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createTaxRateSchema.parse(req.body);
    reply.status(201).send({ data: await catalogs.createTaxRate(auth, companyId, input, req.user.sub, requestMeta(req)) });
  });

  // ✅ CORREGIDO: Añadido taxRateId en la desestructuración
  app.patch('/platform/companies/:companyId/tax-rates/:taxRateId', platformPre, async (req, reply) => {
    const { companyId, taxRateId } = companyIdParamSchema
      .extend({ taxRateId: taxRateIdParamsSchema.shape.taxRateId })
      .parse(req.params);
    
    const input = updateTaxRateSchema.parse(req.body);
    reply.send({ data: await catalogs.updateTaxRate(auth, companyId, taxRateId, input, req.user.sub, requestMeta(req)) });
  });

  app.post('/platform/companies/:companyId/payment-methods', platformPre, async (req, reply) => {
    const { companyId } = companyIdParamSchema.parse(req.params);
    const input = createPaymentMethodSchema.parse(req.body);
    reply.status(201).send({ data: await catalogs.createPaymentMethod(auth, companyId, input, req.user.sub, requestMeta(req)) });
  });

  // ✅ CORREGIDO: Añadido paymentMethodId en la desestructuración
  app.patch('/platform/companies/:companyId/payment-methods/:paymentMethodId', platformPre, async (req, reply) => {
    const { companyId, paymentMethodId } = companyIdParamSchema
      .extend({ paymentMethodId: paymentMethodIdParamsSchema.shape.paymentMethodId })
      .parse(req.params);

    const input = updatePaymentMethodSchema.parse(req.body);
    reply.send({ data: await catalogs.updatePaymentMethod(auth, companyId, paymentMethodId, input, req.user.sub, requestMeta(req)) });
  });
}