import { z } from 'zod';

export const companyIdParamSchema = z.object({ companyId: z.string().uuid() });
export const userIdAndCompanyParamSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const createUserSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128).optional(),
  fullName: z.string().trim().min(1).max(120),
  locale: z.enum(['es', 'en', 'tr', 'zh-CN', 'ja', 'ko']).optional(),
  roleIds: z.array(z.string().uuid()).min(1),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(['es', 'en', 'tr', 'zh-CN', 'ja', 'ko']).optional(),
  password: z.string().min(8).max(128).optional(),
  status: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  roleId: z.string().uuid().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;