import { z } from 'zod';

export const adjustInventorySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().finite(),
  type: z.enum(['ENTRADA', 'SALIDA', 'AJUSTE']),
  reason: z.string().trim().max(255).optional(),
  referenceType: z.string().trim().max(50).optional(),
  referenceId: z.string().uuid().optional(),
});

export const listInventoryQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
