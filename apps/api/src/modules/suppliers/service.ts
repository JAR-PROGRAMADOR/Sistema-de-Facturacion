import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import * as repo from './repository.js';
import type { CreateSupplierInput, ListSuppliersQuery, UpdateSupplierInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type Supplier = repo.SupplierRow;

export async function listSuppliers(
  ctx: AuthContext,
  companyId: string,
  query: ListSuppliersQuery,
): Promise<{ items: Supplier[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const filter = { search: query.search, active: query.active };

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listSuppliers(c, companyId, { ...filter, limit, offset: (page - 1) * limit }),
      repo.countSuppliers(c, companyId, filter),
    ]);
    return { items, total, page, limit };
  });
}

export async function getSupplier(ctx: AuthContext, companyId: string, supplierId: string): Promise<Supplier> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const supplier = await repo.findSupplierById(c, companyId, supplierId);
    if (!supplier) throw new AppError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.', 404);
    return supplier;
  });
}

export async function createSupplier(
  ctx: AuthContext,
  companyId: string,
  input: CreateSupplierInput,
  meta: RequestMeta,
): Promise<Supplier> {
  const id = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    await repo.insertSupplier(c, { id, companyId, ...input, email: input.email || null });
    await insertAudit(c, {
      companyId,
      action: 'supplier.created',
      ip: meta.ip,
      metadata: { supplierId: id, name: input.name },
    });

    const created = await repo.findSupplierById(c, companyId, id);
    if (!created) throw new AppError('INTERNAL_ERROR', 'No fue posible crear el proveedor.', 500);
    return created;
  });
}

export async function updateSupplier(
  ctx: AuthContext,
  companyId: string,
  supplierId: string,
  input: UpdateSupplierInput,
  meta: RequestMeta,
): Promise<Supplier> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findSupplierById(c, companyId, supplierId);
    if (!current) throw new AppError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.', 404);

    const patch: Parameters<typeof repo.updateSupplier>[3] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.taxId !== undefined) patch.tax_id = input.taxId;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.address !== undefined) patch.address = input.address;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    await repo.updateSupplier(c, companyId, supplierId, patch);
    await insertAudit(c, {
      companyId,
      action: 'supplier.updated',
      ip: meta.ip,
      metadata: { supplierId, patch },
    });

    const updated = await repo.findSupplierById(c, companyId, supplierId);
    if (!updated) throw new AppError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.', 404);
    return updated;
  });
}

export async function setSupplierStatus(
  ctx: AuthContext,
  companyId: string,
  supplierId: string,
  isActive: boolean,
  meta: RequestMeta,
): Promise<Supplier> {
  return updateSupplier(ctx, companyId, supplierId, { isActive }, meta);
}

export async function deactivateSupplier(
  ctx: AuthContext,
  companyId: string,
  supplierId: string,
  meta: RequestMeta,
): Promise<void> {
  await setSupplierStatus(ctx, companyId, supplierId, false, meta);
}
