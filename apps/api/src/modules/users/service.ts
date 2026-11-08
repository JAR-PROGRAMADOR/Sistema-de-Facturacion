import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withContext } from '../../database/client.js';
import type { AuthContext } from '../auth/service.js';
import { hashPassword } from '../auth/password.js';
import { insertAudit } from '../auth/repository.js';
import { AppError } from '../../shared/errors.js';
import * as repo from './repository.js';
import type { CreateUserInput, UpdateUserInput, ListUsersQuery } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface UserWithRoles {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  status: 'ACTIVO' | 'INACTIVO';
  isPlatformAdmin: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  roles: { id: string; name: string }[];
}

export interface ListUsersResult {
  items: UserWithRoles[];
  total: number;
  page: number;
  limit: number;
}

function group(rows: repo.MembershipWithUserRow[]): UserWithRoles[] {
  const map = new Map<string, UserWithRoles>();
  for (const r of rows) {
    let u = map.get(r.user_id);
    if (!u) {
      u = {
        id: r.user_id,
        email: r.email,
        fullName: r.full_name,
        locale: r.locale,
        status: r.membership_status === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO',
        isPlatformAdmin: r.is_platform_admin,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        roles: [],
      };
      map.set(r.user_id, u);
    }
    u.roles.push({ id: r.role_id, name: r.role_name });
  }
  return Array.from(map.values());
}

async function assertRolesBelongToCompany(
  c: PoolClient,
  companyId: string,
  roleIds: string[],
): Promise<void> {
  const valid = await repo.rolesBelongToCompany(c, companyId, roleIds);
  const missing = roleIds.filter((id) => !valid.includes(id));
  if (missing.length > 0) {
    throw new AppError(
      'ROLE_CROSS_COMPANY',
      `Roles no pertenecen a esta empresa: ${missing.join(', ')}`,
      400,
    );
  }
}

async function assertNotLastAdmin(
  c: PoolClient,
  companyId: string,
  userId: string,
  reason: 'status' | 'role',
): Promise<void> {
  const isAdmin = await repo.userHasAdminRole(c, companyId, userId);
  if (!isAdmin) return;
  const admins = await repo.countActiveAdmins(c, companyId);
  if (admins <= 1) {
    const msg =
      reason === 'status'
        ? 'No puedes desactivar al último Administrador activo de la empresa.'
        : 'No puedes quitarle el rol Administrador al último Administrador activo.';
    throw new AppError('LAST_ADMIN', msg, 409);
  }
}

// ------------------------------------------------------------------ Lectura

export async function listUsers(
  ctx: AuthContext,
  companyId: string,
  q: ListUsersQuery,
): Promise<ListUsersResult> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const offset = (q.page - 1) * q.limit;
    const rows = await repo.listMembershipsByCompany(c, companyId, {
      limit: q.limit,
      offset,
      search: q.search,
      status: q.status,
      roleId: q.roleId,
    });
    const total = await repo.countMembershipsByCompany(c, companyId, {
      search: q.search,
      status: q.status,
      roleId: q.roleId,
    });
    return { items: group(rows), total, page: q.page, limit: q.limit };
  });
}

export async function getUser(
  ctx: AuthContext,
  companyId: string,
  userId: string,
): Promise<UserWithRoles> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const rows = await repo.findMembershipsByUser(c, companyId, userId);
    if (rows.length === 0) {
      throw new AppError('USER_NOT_FOUND', 'El usuario no existe en esta empresa.', 404);
    }
    return group(rows)[0]!;
  });
}

// ------------------------------------------------------------------ Escritura

export async function createUser(
  ctx: AuthContext,
  companyId: string,
  input: CreateUserInput,
  meta: RequestMeta,
): Promise<UserWithRoles> {
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password ?? 'TempPass123!');
  const locale = input.locale ?? 'es';

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const existing = await repo.findUserByEmail(c, input.email);
    if (existing) {
      throw new AppError('EMAIL_TAKEN', 'Ya existe un usuario con ese correo.', 409);
    }

    // Un usuario nuevo nace solo con el rol Vendedor: los roles que se manden
    // en la petición se ignoran, para que nadie pueda crear un Administrador
    // desde el formulario de alta. Cambiar roles después sigue siendo posible
    // desde Editar (updateUser).
    const sellerRoleId = await repo.findSellerRoleId(c, companyId);
    if (!sellerRoleId) {
      throw new AppError(
        'SELLER_ROLE_NOT_FOUND',
        'La empresa no tiene el rol Vendedor.',
        500,
      );
    }

    await repo.insertUser(c, {
      id,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      locale,
    });

    await repo.insertMembership(c, companyId, id, sellerRoleId, 'ACTIVO');

    await insertAudit(c, {
      companyId,
      action: 'user.created',
      ip: meta.ip,
      metadata: { userId: id, email: input.email, roleIds: [sellerRoleId] },
    });

    return group(await repo.findMembershipsByUser(c, companyId, id))[0]!;
  });
}

export async function updateUser(
  ctx: AuthContext,
  companyId: string,
  userId: string,
  input: UpdateUserInput,
  meta: RequestMeta,
): Promise<UserWithRoles> {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const before = await repo.findMembershipsByUser(c, companyId, userId);
    if (before.length === 0) {
      throw new AppError('USER_NOT_FOUND', 'El usuario no existe en esta empresa.', 404);
    }

    const currentStatus: 'ACTIVO' | 'INACTIVO' =
      before[0]!.membership_status === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO';
    const desiredStatus = input.status ?? currentStatus;

    // Regla: no dejar la empresa sin Administrador activo.
    if (input.status === 'INACTIVO') {
      await assertNotLastAdmin(c, companyId, userId, 'status');
    }
    if (input.roleIds) {
      await assertRolesBelongToCompany(c, companyId, input.roleIds);
      const adminRoleId = await repo.findAdminRoleId(c, companyId);
      if (adminRoleId && !input.roleIds.includes(adminRoleId)) {
        await assertNotLastAdmin(c, companyId, userId, 'role');
      }
    }

    // 1) Actualizar users.
    const userPatch: { full_name?: string; locale?: string; password_hash?: string } = {};
    if (input.fullName !== undefined) userPatch.full_name = input.fullName;
    if (input.locale !== undefined) userPatch.locale = input.locale;
    if (passwordHash) userPatch.password_hash = passwordHash;
    if (Object.keys(userPatch).length > 0) {
      await repo.updateUser(c, userId, userPatch);
    }

    // 2) Membresías: si se pasan roleIds, se reemplazan (con el status deseado).
    if (input.roleIds) {
      await repo.deleteMemberships(c, companyId, userId);
      for (const roleId of input.roleIds) {
        await repo.insertMembership(c, companyId, userId, roleId, desiredStatus);
      }
    } else if (input.status !== undefined) {
      await repo.updateMembershipStatus(c, companyId, userId, input.status);
    }

    await insertAudit(c, {
      companyId,
      action: 'user.updated',
      ip: meta.ip,
      metadata: {
        userId,
        patch: { ...input, password: input.password ? '***' : undefined },
      },
    });

    return group(await repo.findMembershipsByUser(c, companyId, userId))[0]!;
  });
}

export async function deactivateUser(
  ctx: AuthContext,
  companyId: string,
  userId: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const rows = await repo.findMembershipsByUser(c, companyId, userId);
    if (rows.length === 0) {
      throw new AppError('USER_NOT_FOUND', 'El usuario no existe en esta empresa.', 404);
    }

    await assertNotLastAdmin(c, companyId, userId, 'status');
    await repo.updateMembershipStatus(c, companyId, userId, 'INACTIVO');

    await insertAudit(c, {
      companyId,
      action: 'user.deactivated',
      ip: meta.ip,
      metadata: { userId },
    });
  });
}