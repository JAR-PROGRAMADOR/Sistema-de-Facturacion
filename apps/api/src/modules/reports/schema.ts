import { z } from 'zod';

export const companyIdParamSchema = z.object({ companyId: z.string().uuid() });
export const reportCompanyParamsSchema = z.object({ companyId: z.string().uuid() });

export const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const topProductsQuerySchema = dateRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
