import { z } from 'zod';

export const companyIdParamSchema = z.object({ companyId: z.string().uuid() });
export const updateSettingsSchema = z.object({
  requireCustomerOnSale: z.boolean().optional(),
  requirePaymentReference: z.boolean().optional(),
  receiptFooter: z.string().trim().max(500).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Indica al menos una preferencia para actualizar.');

export const taxRateIdParamsSchema = z.object({ taxRateId: z.string().uuid() });
export const paymentMethodIdParamsSchema = z.object({ paymentMethodId: z.string().uuid() });

export const createTaxRateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rate: z.coerce.number().min(0).max(100),
  isDefault: z.boolean().optional(),
});

export const updateTaxRateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rate: z.coerce.number().min(0).max(100).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar.');

export const createPaymentMethodSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
});

export const updatePaymentMethodSchema = z.object({
  name: z.string().trim().optional(),
  isActive: z.boolean().optional(), // debe ser camelCase
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
