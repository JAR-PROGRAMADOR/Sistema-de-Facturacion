import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import type { AuthContext } from '../auth/service.js';
import { insertAudit } from '../auth/repository.js';
import { AppError } from '../../shared/errors.js';
import * as repo from './repository.js';
import type {
  CreateRoleInput,
  UpdateRoleInput,
  SetRolePermissionsInput,
} from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface RoleWithPermissions {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  permissionCodes: string[];
}

function toApi(row: repo.RoleRow, codes: string[]): RoleWithPermissions {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    createdAt: row.created_at,
    permissionCodes: codes,
  };
}

// ------------------------------------------------------------- Catálogo global

export async function listPermissions(ctx: AuthContext): Promise<repo.PermissionRow[]> {
  return withContext(ctx.pool, { platform: true }, (c) => repo.listPermissions(c));
}

// -------------------------------------------------------------------- Roles

export async function listRoles(
  ctx: AuthContext,
  companyId: string,
): Promise<RoleWithPermissions[]> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const rows = await repo.listRoles(c);
    const out: RoleWithPermissions[] = [];
    for (const r of rows) {
      const codes = await repo.listRolePermissionCodes(c, r.id);
      out.push(toApi(r, codes));
    }
    return out;
  });
}

export async function getRole(
  ctx: AuthContext,
  companyId: string,
  roleId: string,
): Promise<RoleWithPermissions> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const row = await repo.findRoleById(c, companyId, roleId);
    if (!row) throw new AppError('ROLE_NOT_FOUND', 'El rol no existe.', 404);
    const codes = await repo.listRolePermissionCodes(c, roleId);
    return toApi(row, codes);
  });
}

export async function createRole(
  ctx: AuthContext,
  companyId: string,
  input: CreateRoleInput,
  meta: RequestMeta,
): Promise<RoleWithPermissions> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    if (await repo.roleNameExists(c, companyId, input.name)) {
      throw new AppError(
        'ROLE_NAME_TAKEN',
        'Ya existe un rol con ese nombre en la empresa.',
        409,
      );
    }

    const id = randomUUID();
    await repo.insertRole(c, {
      id,
      companyId,
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
    });

    if (input.permissionCodes && input.permissionCodes.length > 0) {
      await repo.replaceRolePermissions(c, companyId, id, input.permissionCodes);
    }

    await insertAudit(c, {
      companyId,
      action: 'role.created',
      ip: meta.ip,
      metadata: {
        roleId: id,
        name: input.name,
        permissionCodes: input.permissionCodes ?? [],
      },
    });

    const row = (await repo.findRoleById(c, companyId, id))!;
    const codes = await repo.listRolePermissionCodes(c, id);
    return toApi(row, codes);
  });
}

export async function updateRole(
  ctx: AuthContext,
  companyId: string,
  roleId: string,
  input: UpdateRoleInput,
  meta: RequestMeta,
): Promise<RoleWithPermissions> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const existing = await repo.findRoleById(c, companyId, roleId);
    if (!existing) throw new AppError('ROLE_NOT_FOUND', 'El rol no existe.', 404);

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      if (await repo.roleNameExists(c, companyId, input.name, roleId)) {
        throw new AppError('ROLE_NAME_TAKEN', 'Ya existe un rol con ese nombre.', 409);
      }
    }

    const patch: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    await repo.updateRole(c, companyId, roleId, patch);

    await insertAudit(c, {
      companyId,
      action: 'role.updated',
      ip: meta.ip,
      metadata: { roleId, patch: input },
    });

    const row = (await repo.findRoleById(c, companyId, roleId))!;
    const codes = await repo.listRolePermissionCodes(c, roleId);
    return toApi(row, codes);
  });
}

export async function deleteRole(
  ctx: AuthContext,
  companyId: string,
  roleId: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const existing = await repo.findRoleById(c, companyId, roleId);
    if (!existing) throw new AppError('ROLE_NOT_FOUND', 'El rol no existe.', 404);

    if (existing.is_system) {
      throw new AppError(
        'SYSTEM_ROLE_READONLY',
        'No se puede eliminar un rol del sistema.',
        409,
      );
    }

    const inUse = await repo.countActiveUsersWithRole(c, roleId);
    if (inUse > 0) {
      throw new AppError(
        'ROLE_IN_USE',
        'El rol está asignado a usuarios activos. Reasígnalos antes de eliminarlo.',
        409,
      );
    }

    await repo.deleteRole(c, companyId, roleId);

    await insertAudit(c, {
      companyId,
      action: 'role.deleted',
      ip: meta.ip,
      metadata: { roleId, name: existing.name },
    });
  });
}

export async function setRolePermissions(
  ctx: AuthContext,
  companyId: string,
  roleId: string,
  input: SetRolePermissionsInput,
  meta: RequestMeta,
): Promise<RoleWithPermissions> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const existing = await repo.findRoleById(c, companyId, roleId);
    if (!existing) throw new AppError('ROLE_NOT_FOUND', 'El rol no existe.', 404);

    const catalog = await repo.listPermissions(c);
    const valid = new Set(catalog.map((p) => p.code));
    const invalid = input.permissionCodes.filter((code) => !valid.has(code));
    if (invalid.length > 0) {
      throw new AppError(
        'UNKNOWN_PERMISSION',
        `Permisos desconocidos: ${invalid.join(', ')}`,
        400,
      );
    }

    const dedup = Array.from(new Set(input.permissionCodes));
    await repo.replaceRolePermissions(c, companyId, roleId, dedup);

    await insertAudit(c, {
      companyId,
      action: 'role.permissions_replaced',
      ip: meta.ip,
      metadata: { roleId, count: dedup.length },
    });

    const row = (await repo.findRoleById(c, companyId, roleId))!;
    const codes = await repo.listRolePermissionCodes(c, roleId);
    return toApi(row, codes);
  });
}