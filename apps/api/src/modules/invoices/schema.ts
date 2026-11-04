import { z } from 'zod';

export const saleIdParamSchema = z.object({ saleId: z.string().uuid() });
export const invoiceIdParamSchema = z.object({ invoiceId: z.string().uuid() });
export const cancelInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export const invoiceCompanyParamsSchema = z.object({ companyId: z.string().uuid() });
export const invoiceSaleCompanyParamsSchema = z.object({ companyId: z.string().uuid(), saleId: z.string().uuid() });
export const invoiceIdCompanyParamsSchema = z.object({ companyId: z.string().uuid(), invoiceId: z.string().uuid() });
export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['EMITIDA', 'ANULADA']).optional(),
});
