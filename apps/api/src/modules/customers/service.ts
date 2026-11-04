import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import * as repo from './repository.js';
import type { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type Customer = repo.CustomerRow;

export async function listCustomers(
  ctx: AuthContext,
  companyId: string,
  query: ListCustomersQuery,
): Promise<{ items: Customer[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const filter = { search: query.search, active: query.active };

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listCustomers(c, companyId, { ...filter, limit, offset: (page - 1) * limit }),
      repo.countCustomers(c, companyId, filter),
    ]);
    return { items, total, page, limit };
  });
}

export async function getCustomer(
  ctx: AuthContext,
  companyId: string,
  customerId: string,
): Promise<Customer> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const customer = await repo.findCustomerById(c, companyId, customerId);
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'El cliente no existe.', 404);
    return customer;
  });
}

export async function createCustomer(
  ctx: AuthContext,
  companyId: string,
  input: CreateCustomerInput,
  meta: RequestMeta,
): Promise<Customer> {
  const id = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    await repo.insertCustomer(c, {
      id,
      companyId,
      ...input,
      email: input.email || null,
    });

    await insertAudit(c, {
      companyId,
      action: 'customer.created',
      ip: meta.ip,
      metadata: { customerId: id, name: input.name },
    });

    const created = await repo.findCustomerById(c, companyId, id);
    if (!created) throw new AppError('INTERNAL_ERROR', 'No fue posible crear el cliente.', 500);
    return created;
  });
}

export async function updateCustomer(
  ctx: AuthContext,
  companyId: string,
  customerId: string,
  input: UpdateCustomerInput,
  meta: RequestMeta,
): Promise<Customer> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findCustomerById(c, companyId, customerId);
    if (!current) throw new AppError('CUSTOMER_NOT_FOUND', 'El cliente no existe.', 404);

    const patch: Parameters<typeof repo.updateCustomer>[3] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.taxId !== undefined) patch.tax_id = input.taxId;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.address !== undefined) patch.address = input.address;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    await repo.updateCustomer(c, companyId, customerId, patch);
    await insertAudit(c, {
      companyId,
      action: 'customer.updated',
      ip: meta.ip,
      metadata: { customerId, patch },
    });

    const updated = await repo.findCustomerById(c, companyId, customerId);
    if (!updated) throw new AppError('CUSTOMER_NOT_FOUND', 'El cliente no existe.', 404);
    return updated;
  });
}

export async function setCustomerStatus(
  ctx: AuthContext,
  companyId: string,
  customerId: string,
  isActive: boolean,
  meta: RequestMeta,
): Promise<Customer> {
  return updateCustomer(ctx, companyId, customerId, { isActive }, meta);
}

export async function deactivateCustomer(
  ctx: AuthContext,
  companyId: string,
  customerId: string,
  meta: RequestMeta,
): Promise<void> {
  await setCustomerStatus(ctx, companyId, customerId, false, meta);
}
