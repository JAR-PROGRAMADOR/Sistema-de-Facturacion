import { z } from 'zod';

export const companyIdParamSchema = z.object({ companyId: z.string().uuid() });
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(120).optional(),
  result: z.enum(['OK', 'ERROR']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
