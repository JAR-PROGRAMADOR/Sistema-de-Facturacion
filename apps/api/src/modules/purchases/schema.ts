import { z } from 'zod';

export const createPurchaseSchema = z.object({
  supplierId: z.string().uuid(),
  paymentMethodId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive().max(1_000_000).multipleOf(0.001),
    unitCost: z.number().nonnegative().max(100_000_000),
  })).min(1).max(100).refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    'No repitas un producto en la misma compra.',
  ),
});

export const purchaseIdParamSchema = z.object({ purchaseId: z.string().uuid() });
export const cancelPurchaseSchema = z.object({ reason: z.string().trim().min(3).max(255) });
export const purchaseCompanyParamsSchema = z.object({ companyId: z.string().uuid() });
export const purchaseIdCompanyParamsSchema = z.object({ companyId: z.string().uuid(), purchaseId: z.string().uuid() });
export const listPurchasesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['RECIBIDA', 'ANULADA']).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
