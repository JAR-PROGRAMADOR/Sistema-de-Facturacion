import { randomUUID } from 'node:crypto';

import { applyContext, withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { hashPassword } from '../auth/password.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';

import * as repo from './repository.js';
import type { CreateCompanyInput, UpdateCompanyInput } from './schema.js';
import { seedCompanyDefaults } from './seed.js';

export type Company = repo.CompanyRow;

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function createCompany(
  ctx: AuthContext,
  input: CreateCompanyInput,
  meta: RequestMeta,
  adminPassword?: string,
): Promise<repo.CompanyRow & { adminRoleId?: string; vendorRoleId?: string; adminUserCreated?: boolean; adminUserId?: string | null }> {
  const id = randomUUID();

  // ✅ Un solo withContext con companyId desde el arranque.
  return withContext(ctx.pool, { platform: true, companyId: id }, async (c) => {
    await repo.insertCompany(c, {
      id,
      name: input.name,
      legalName: input.legalName ?? null,
      taxId: input.taxId ?? null,
      country: input.country ?? null,
      currency: input.currency,
      locale: input.locale,
      timezone: input.timezone,
    });

    const defaultRoles = await seedCompanyDefaults(c, id);
    let adminUserId: string | null = null;
    let adminUserCreated = false;
    const adminEmail = input.adminEmail?.trim();
    const adminFullName = input.adminFullName?.trim() || 'Administrador';
    if (adminEmail) {
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [adminEmail],
      );
      if (adminPassword && existing.rowCount) {
        throw new AppError('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con ese correo.', 409);
      }
      adminUserId = existing.rows[0]?.id ?? randomUUID();
      if (!existing.rowCount) {
        await c.query(
          `INSERT INTO users (id, email, password_hash, full_name, locale, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVO')`,
          [adminUserId, adminEmail, await hashPassword(adminPassword ?? randomUUID()), adminFullName, input.locale],
        );
      }
      await c.query(
        `INSERT INTO company_users (company_id, user_id, role_id, status)
         VALUES ($1, $2, $3, 'ACTIVO')
         ON CONFLICT (company_id, user_id, role_id) DO UPDATE SET status = 'ACTIVO'`,
        [id, adminUserId, defaultRoles.adminRoleId],
      );
      adminUserCreated = true;
    }

    await insertAudit(c, {
      companyId: id,
      action: 'company.created',
      metadata: { name: input.name, currency: input.currency, locale: input.locale },
    });

    const created = await repo.findCompanyById(c, id);
    if (!created) throw new AppError('INTERNAL_ERROR', 'No fue posible crear la empresa.', 500);
    return {
      ...created,
      adminRoleId: defaultRoles.adminRoleId,
      vendorRoleId: defaultRoles.vendorRoleId,
      adminUserCreated,
      adminUserId,
    };
  });
}

export async function listCompanies(
  ctx: AuthContext,
  query: { page?: number; limit?: number; offset?: number; search?: string; status?: 'ACTIVA' | 'SUSPENDIDA' },
): Promise<{ items: Company[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const offset = typeof query.offset === 'number' ? query.offset : (page - 1) * limit;

  return withContext(ctx.pool, { platform: true }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listCompanies(c, { limit, offset, search: query.search, status: query.status }),
      repo.countCompanies(c, { search: query.search, status: query.status }),
    ]);

    return { items, total };
  });
}

export async function countCompanies(
  ctx: AuthContext,
  query: { search?: string; status?: 'ACTIVA' | 'SUSPENDIDA' },
): Promise<number> {
  return withContext(ctx.pool, { platform: true }, async (c) => {
    return repo.countCompanies(c, query);
  });
}

export async function getMyCompany(
  ctx: AuthContext,
  input: { userId: string; companyId: string | null; platform: boolean },
): Promise<Company> {
  if (!input.companyId) {
    throw new AppError('COMPANY_NOT_FOUND', 'El usuario no tiene una empresa activa.', 404);
  }

  return withContext(ctx.pool, {
    platform: input.platform,
    userId: input.userId,
    companyId: input.companyId,
  }, async (c) => {
    const company = await repo.findCompanyById(c, input.companyId!);
    if (!company) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }

    const membership = await c.query<{ company_id: string }>(
      `SELECT company_id
         FROM company_users
        WHERE user_id = $1 AND company_id = $2 AND status = 'ACTIVO' LIMIT 1`,
      [input.userId, input.companyId],
    );

    if (membership.rowCount === 0) {
      throw new AppError('COMPANY_NOT_FOUND', 'El usuario no pertenece a la empresa indicada.', 404);
    }

    return company;
  });
}

export async function getCompany(ctx: AuthContext, id: string): Promise<Company> {
  return withContext(ctx.pool, { platform: true }, async (c) => {
    const row = await repo.findCompanyById(c, id);
    if (!row) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }
    return row;
  });
}

export async function updateCompany(
  ctx: AuthContext,
  id: string,
  input: UpdateCompanyInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<Company> {
  return withContext(ctx.pool, { platform: true }, async (c) => {
    const current = await repo.findCompanyById(c, id);
    if (!current) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }

    const patch: Partial<Pick<Company, 'name' | 'legal_name' | 'tax_id' | 'country' | 'currency' | 'locale' | 'timezone' | 'status'>> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.legalName !== undefined) patch.legal_name = input.legalName;
    if (input.taxId !== undefined) patch.tax_id = input.taxId;
    if (input.country !== undefined) patch.country = input.country;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.status !== undefined) patch.status = input.status;

    if (Object.keys(patch).length > 0) {
      await repo.updateCompany(c, id, patch);
    }

    await insertAudit(c, {
      companyId: id,
      action: 'company.updated',
      ip: meta.ip,
      metadata: { companyId: id, patch },
    });

    const row = await repo.findCompanyById(c, id);
    if (!row) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }
    return row;
  });
}

export async function setCompanyStatus(
  ctx: AuthContext,
  id: string,
  status: 'ACTIVA' | 'SUSPENDIDA',
  meta: { ip: string | null; userAgent: string | null },
): Promise<Company> {
  return withContext(ctx.pool, { platform: true }, async (c) => {
    const current = await repo.findCompanyById(c, id);
    if (!current) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }

    if (current.status === status) {
      return current;
    }

    await repo.setCompanyStatus(c, id, status);
    await insertAudit(c, {
      companyId: id,
      action: 'company.status_changed',
      ip: meta.ip,
      metadata: { companyId: id, status },
    });

    const row = await repo.findCompanyById(c, id);
    if (!row) {
      throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);
    }
    return row;
  });
}
