import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: optionalText(80),
  email: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional(),
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  taxId: optionalText(80),
  email: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional(),
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const supplierIdParamSchema = z.object({ supplierId: z.string().uuid() });

export const listSuppliersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  active: z.enum(['all', 'active', 'inactive']).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
