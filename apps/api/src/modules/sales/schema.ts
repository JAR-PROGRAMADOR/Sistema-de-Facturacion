import { z } from 'zod';

export const createSaleSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  cashSessionId: z.string().uuid().nullable().optional(),
  paymentMethodId: z.string().uuid(),
  paymentReference: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive().max(1_000_000).multipleOf(0.001),
    discount: z.number().nonnegative().max(100_000_000).default(0),
  })).min(1).max(100).refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    'No repitas un producto en la misma venta.',
  ),
});

export const saleIdParamSchema = z.object({ saleId: z.string().uuid() });
export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3).max(255),
  refundReference: z.string().trim().max(255).nullable().optional(),
});
export const companyIdParamSchema = z.object({ companyId: z.string().uuid() });
export const saleIdAndCompanyParamSchema = z.object({ companyId: z.string().uuid(), saleId: z.string().uuid() });

export const listSalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['COMPLETADA', 'CANCELADA']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
