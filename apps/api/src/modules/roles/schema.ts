import { z } from 'zod';

const uuid = z.string().uuid();

export const companyIdParamSchema = z.object({ companyId: uuid });
export const roleIdParamSchema = z.object({ roleId: uuid });
export const roleIdAndCompanyParamSchema = z.object({ companyId: uuid, roleId: uuid });

const permissionCodeSchema = z.string().trim().min(1).max(100);

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).nullable().optional(),
  permissionCodes: z.array(permissionCodeSchema).max(500).optional(),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Envía al menos un campo para actualizar.' });

export const setRolePermissionsSchema = z.object({
  permissionCodes: z.array(permissionCodeSchema).max(500),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;