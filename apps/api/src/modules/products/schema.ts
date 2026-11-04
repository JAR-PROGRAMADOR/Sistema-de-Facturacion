import { z } from 'zod';

export const createProductSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional().nullable(),
  type: z.enum(['BIEN', 'SERVICIO']).default('BIEN'),
  price: z.coerce.number().nonnegative(),
  cost: z.coerce.number().nonnegative().optional().nullable(),
  trackStock: z.boolean().default(true),
  minStock: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().optional(),
  initialStock: z.coerce.number().nonnegative().optional(),
});

export const updateProductSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().min(1).max(80).optional(),
  barcode: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  type: z.enum(['BIEN', 'SERVICIO']).optional(),
  price: z.coerce.number().nonnegative().optional(),
  cost: z.coerce.number().nonnegative().optional().nullable(),
  trackStock: z.boolean().optional(),
  minStock: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export const productIdParamSchema = z.object({ productId: z.string().uuid() });

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  active: z.enum(['all', 'active', 'inactive']).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
