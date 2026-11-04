import { z } from 'zod';

export const openCashSessionSchema = z.object({ openingAmount: z.coerce.number().finite().min(0).max(1_000_000_000) });
export const cashSessionIdParamSchema = z.object({ cashSessionId: z.string().uuid() });
export const cashSessionAndCompanyParamSchema = z.object({ companyId: z.string().uuid(), cashSessionId: z.string().uuid() });
export const createCashMovementSchema = z.object({
  type: z.enum(['INGRESO', 'EGRESO']),
  amount: z.coerce.number().finite().positive().max(1_000_000_000),
  reason: z.string().trim().min(1).max(255),
});
export const closeCashSessionSchema = z.object({ closingAmountDeclared: z.coerce.number().finite().min(0).max(1_000_000_000) });

export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;
