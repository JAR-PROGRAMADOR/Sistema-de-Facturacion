import { z } from 'zod';

export const localeSchema = z.enum(['es', 'en', 'tr', 'zh-CN', 'ja', 'ko']);
export const currencySchema = z.string().trim().toUpperCase().length(3);
export const countrySchema = z.string().trim().toUpperCase().length(2);

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(40).optional(),
  country: countrySchema.optional(),
  currency: currencySchema.default('USD'),
  locale: localeSchema.default('es'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  adminEmail: z.string().trim().email().optional(),
  adminFullName: z.string().trim().min(1).max(120).optional(),
});

export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    legalName: z.string().trim().max(200).nullable().optional(),
    taxId: z.string().trim().max(40).nullable().optional(),
    country: countrySchema.nullable().optional(),
    currency: currencySchema.optional(),
    locale: localeSchema.optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    status: z.enum(['ACTIVA', 'SUSPENDIDA']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Envía al menos un campo para actualizar.' });

export const listCompaniesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVA', 'SUSPENDIDA']).optional(),
});

export const companyIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;