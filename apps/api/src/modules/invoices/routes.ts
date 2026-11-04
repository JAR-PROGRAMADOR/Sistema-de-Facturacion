import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../auth/service.js';
import * as service from './service.js';
import { cancelInvoiceSchema, invoiceCompanyParamsSchema, invoiceIdCompanyParamsSchema, invoiceIdParamSchema, invoiceSaleCompanyParamsSchema, listInvoicesQuerySchema, saleIdParamSchema } from './schema.js';

function currentCompanyId(req: FastifyRequest): string {
  const cid = req.user?.cid;
  if (!cid) throw new AppError('NO_ACTIVE_COMPANY', 'Tu usuario no está asociado a una empresa.', 403);
  return cid;
}

function requestMeta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

export async function invoicesRoutes(
  app: FastifyInstance,
  opts: { env: Env; auth: AuthContext },
): Promise<void> {
  const { auth } = opts;

  app.get('/invoices', { preHandler: app.authenticate }, async (req, reply) => {
    const query = listInvoicesQuerySchema.parse(req.query);
    const result = await service.listInvoices(auth, currentCompanyId(req), query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.get('/invoices/:invoiceId', { preHandler: app.authenticate }, async (req, reply) => {
    const { invoiceId } = invoiceIdParamSchema.parse(req.params);
    reply.send({ data: await service.getInvoice(auth, currentCompanyId(req), invoiceId) });
  });

  app.post('/sales/:saleId/invoice', { preHandler: app.authenticate }, async (req, reply) => {
    const { saleId } = saleIdParamSchema.parse(req.params);
    const invoice = await service.issueInvoice(auth, currentCompanyId(req), saleId, req.user.sub, requestMeta(req));
    reply.status(201).send({ data: invoice });
  });

  app.post('/invoices/:invoiceId/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const { invoiceId } = invoiceIdParamSchema.parse(req.params);
    const input = cancelInvoiceSchema.parse(req.body);
    await service.cancelInvoice(auth, currentCompanyId(req), invoiceId, req.user.sub, input.reason, requestMeta(req));
    reply.status(204).send();
  });

  const platformPre = { preHandler: [app.authenticate, app.requirePlatform] };

  app.get('/platform/companies/:companyId/invoices', platformPre, async (req, reply) => {
    const { companyId } = invoiceCompanyParamsSchema.parse(req.params);
    const query = listInvoicesQuerySchema.parse(req.query);
    const result = await service.listInvoices(auth, companyId, query);
    reply.send({ data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  });

  app.get('/platform/companies/:companyId/invoices/:invoiceId', platformPre, async (req, reply) => {
    const { companyId, invoiceId } = invoiceIdCompanyParamsSchema.parse(req.params);
    reply.send({ data: await service.getInvoice(auth, companyId, invoiceId) });
  });

  app.post('/platform/companies/:companyId/sales/:saleId/invoice', platformPre, async (req, reply) => {
    const { companyId, saleId } = invoiceSaleCompanyParamsSchema.parse(req.params);
    const invoice = await service.issueInvoice(auth, companyId, saleId, req.user.sub, requestMeta(req));
    reply.status(201).send({ data: invoice });
  });

  app.post('/platform/companies/:companyId/invoices/:invoiceId/cancel', platformPre, async (req, reply) => {
    const { companyId, invoiceId } = invoiceIdCompanyParamsSchema.parse(req.params);
    const input = cancelInvoiceSchema.parse(req.body);
    await service.cancelInvoice(auth, companyId, invoiceId, req.user.sub, input.reason, requestMeta(req));
    reply.status(204).send();
  });
}
