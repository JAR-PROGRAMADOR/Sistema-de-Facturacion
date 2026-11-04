import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: optionalText(80),
  email: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional(),
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  taxId: optionalText(80),
  email: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional(),
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const customerIdParamSchema = z.object({ customerId: z.string().uuid() });

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  active: z.enum(['all', 'active', 'inactive']).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
