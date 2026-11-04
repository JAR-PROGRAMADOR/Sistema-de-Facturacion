import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import type { CreatePaymentMethodInput, CreateTaxRateInput, UpdatePaymentMethodInput, UpdateTaxRateInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface TaxRate {
  id: string;
  company_id: string;
  name: string;
  rate: number;
  is_default: boolean;
  is_active: boolean;
}

export interface PaymentMethod {
  id: string;
  company_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

function duplicateCode(error: unknown, code: string, message: string): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    throw new AppError(code, message, 409);
  }
  throw error;
}

export async function listTaxRates(ctx: AuthContext, companyId: string): Promise<TaxRate[]> {
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const result = await c.query<Omit<TaxRate, 'rate'> & { rate: string }>(
      `SELECT id, company_id, name, rate::text, is_default, is_active FROM tax_rates
        WHERE company_id = $1 ORDER BY is_default DESC, name ASC`,
      [companyId],
    );
    return result.rows.map((row) => ({ ...row, rate: Number(row.rate) }));
  });
}

export async function createTaxRate(
  ctx: AuthContext,
  companyId: string,
  input: CreateTaxRateInput,
  actorId: string,
  meta: RequestMeta,
): Promise<TaxRate> {
  const id = randomUUID();
  try {
    return await withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
      if (input.isDefault) await c.query(`UPDATE tax_rates SET is_default = false WHERE company_id = $1 AND is_default`, [companyId]);
      const result = await c.query<Omit<TaxRate, 'rate'> & { rate: string }>(
        `INSERT INTO tax_rates (id, company_id, name, rate, is_default)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, company_id, name, rate::text, is_default, is_active`,
        [id, companyId, input.name, input.rate, input.isDefault ?? false],
      );
      await insertAudit(c, { companyId, userId: actorId, action: 'tax_rate.created', ip: meta.ip, metadata: { taxRateId: id, name: input.name, rate: input.rate } });
      const row = result.rows[0]!;
      return { ...row, rate: Number(row.rate) };
    });
  } catch (error) {
    duplicateCode(error, 'TAX_RATE_DUPLICATE', 'Ya existe una tasa de impuesto con ese nombre.');
  }
}

export async function updateTaxRate(
  ctx: AuthContext,
  companyId: string,
  taxRateId: string,
  input: UpdateTaxRateInput,
  actorId: string,
  meta: RequestMeta,
): Promise<TaxRate> {
  return withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const current = await c.query<{ id: string; is_default: boolean }>(
      `SELECT id, is_default FROM tax_rates WHERE company_id = $1 AND id = $2`,
      [companyId, taxRateId],
    );
    if (!current.rowCount) throw new AppError('TAX_RATE_NOT_FOUND', 'La tasa de impuesto no existe.', 404);
    if (input.isDefault && input.isActive === false) throw new AppError('INVALID_DEFAULT_TAX_RATE', 'Una tasa inactiva no puede ser predeterminada.', 400);
    if (input.isActive === false) {
      const references = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM products WHERE company_id = $1 AND tax_rate_id = $2 AND deleted_at IS NULL`,
        [companyId, taxRateId],
      );
      if ((references.rows[0]?.count ?? 0) > 0) throw new AppError('TAX_RATE_IN_USE', 'Actualiza primero los productos que usan esta tasa.', 409);
    }

    if (input.isDefault) await c.query(`UPDATE tax_rates SET is_default = false WHERE company_id = $1 AND id <> $2 AND is_default`, [companyId, taxRateId]);
    const patch: { name?: string; rate?: number; is_default?: boolean; is_active?: boolean } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.rate !== undefined) patch.rate = input.rate;
    if (input.isDefault !== undefined) patch.is_default = input.isDefault;
    else if (input.isActive === false && current.rows[0]!.is_default) patch.is_default = false;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const assignments = Object.entries(patch).map(([column], index) => `${column} = $${index + 3}`);
    if (assignments.length === 0) {
      throw new AppError('EMPTY_UPDATE', 'No hay campos para actualizar.', 400);
    }

    const values = Object.values(patch);
    try {
      const result = await c.query<Omit<TaxRate, 'rate'> & { rate: string }>(
        `UPDATE tax_rates SET ${assignments.join(', ')} WHERE company_id = $1 AND id = $2
         RETURNING id, company_id, name, rate::text, is_default, is_active`,
        [companyId, taxRateId, ...values],
      );
      await insertAudit(c, { companyId, userId: actorId, action: 'tax_rate.updated', ip: meta.ip, metadata: { taxRateId, patch } });
      const row = result.rows[0]!;
      return { ...row, rate: Number(row.rate) };
    } catch (error) {
      duplicateCode(error, 'TAX_RATE_DUPLICATE', 'Ya existe una tasa de impuesto con ese nombre.');
    }
  });
}

export async function listPaymentMethods(ctx: AuthContext, companyId: string): Promise<PaymentMethod[]> {
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const result = await c.query<PaymentMethod>(
      `SELECT id, company_id, code, name, is_active FROM payment_methods WHERE company_id = $1 ORDER BY name`,
      [companyId],
    );
    return result.rows;
  });
}

export async function createPaymentMethod(
  ctx: AuthContext,
  companyId: string,
  input: CreatePaymentMethodInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PaymentMethod> {
  const id = randomUUID();
  try {
    return await withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
      const result = await c.query<PaymentMethod>(
        `INSERT INTO payment_methods (id, company_id, code, name) VALUES ($1,$2,$3,$4)
         RETURNING id, company_id, code, name, is_active`,
        [id, companyId, input.code.toUpperCase(), input.name],
      );
      await insertAudit(c, { companyId, userId: actorId, action: 'payment_method.created', ip: meta.ip, metadata: { paymentMethodId: id, code: input.code.toUpperCase() } });
      return result.rows[0]!;
    });
  } catch (error) {
    duplicateCode(error, 'PAYMENT_METHOD_DUPLICATE', 'Ya existe un método de pago con ese código.');
  }
}

export async function updatePaymentMethod(
  ctx: AuthContext,
  companyId: string,
  paymentMethodId: string,
  input: UpdatePaymentMethodInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PaymentMethod> {
  return withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    // 1. Verificar que existe
    const current = await c.query<PaymentMethod>(
      `SELECT id, company_id, code, name, is_active FROM payment_methods WHERE company_id = $1 AND id = $2`,
      [companyId, paymentMethodId],
    );
    if (!current.rowCount) {
      throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'El método de pago no existe.', 404);
    }

    // 2. Construir la query
    const sets: string[] = [];
    const args: unknown[] = [companyId, paymentMethodId];

    if (input.name !== undefined) {
      args.push(input.name);
      sets.push(`name = $${args.length}`);
    }
    if (input.isActive !== undefined) {
      args.push(input.isActive);
      sets.push(`is_active = $${args.length}`);
    }

    if (sets.length === 0) {
      throw new AppError('EMPTY_UPDATE', 'No hay campos para actualizar.', 400);
    }

    // 3. Ejecutar UPDATE
    const result = await c.query<PaymentMethod>(
      `UPDATE payment_methods 
       SET ${sets.join(', ')} 
       WHERE company_id = $1 AND id = $2
       RETURNING id, company_id, code, name, is_active`,
      args,
    );

    if (!result.rowCount) {
      throw new AppError('UPDATE_FAILED', 'No se pudo actualizar el método de pago.', 500);
    }

    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'payment_method.updated',
      ip: meta.ip,
      metadata: { paymentMethodId, input },
    });

    return result.rows[0]!;
  });
}