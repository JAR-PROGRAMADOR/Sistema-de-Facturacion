import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import * as repo from './repository.js';
import type { AdjustInventoryInput, ListInventoryQuery } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function listInventory(
  ctx: AuthContext,
  companyId: string,
  query: ListInventoryQuery,
): Promise<{ items: Array<{ product_id: string; sku: string; name: string; category_id: string | null; quantity: number; min_stock: number; track_stock: boolean; is_active: boolean; category_name: string | null }>; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const offset = (page - 1) * limit;

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listInventory(c, companyId, { limit, offset, search: query.search, categoryId: query.categoryId }),
      repo.countInventory(c, companyId, { search: query.search, categoryId: query.categoryId }),
    ]);

    return { items, total, page, limit };
  });
}

export async function getStock(
  ctx: AuthContext,
  companyId: string,
  productId: string,
): Promise<{ productId: string; quantity: number; minStock: number; trackStock: boolean }> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const product = await c.query<{ id: string; track_stock: boolean; min_stock: number }>(
      `SELECT id, track_stock, min_stock FROM products WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, productId],
    );

    if (product.rowCount === 0) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }

    const item = product.rows[0]!;
    const stock = await repo.findInventoryByProduct(c, companyId, productId);

    return {
      productId: item.id,
      quantity: stock?.quantity ?? 0,
      minStock: item.min_stock,
      trackStock: item.track_stock,
    };
  });
}

export async function adjustStock(
  ctx: AuthContext,
  companyId: string,
  productId: string,
  quantity: number,
  type: 'ENTRADA' | 'SALIDA' | 'AJUSTE',
  reason: string | null,
  referenceId: string | null,
  meta: RequestMeta,
  actorId: string,
): Promise<{ productId: string; quantity: number; type: 'ENTRADA' | 'SALIDA' | 'AJUSTE'; stockAfter: number }> {
  return withContext(ctx.pool, { platform: true, companyId, userId: actorId }, async (c) => {
    const product = await c.query<{ id: string; track_stock: boolean; min_stock: number }>(
      `SELECT id, track_stock, min_stock FROM products WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, productId],
    );

    if (product.rowCount === 0) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }

    const item = product.rows[0]!;
    if (!item.track_stock) {
      throw new AppError('PRODUCT_NO_STOCK_TRACKING', 'Este producto no lleva control de stock.', 400);
    }

    const movement = Number(quantity);
    if (!Number.isFinite(movement) || movement === 0) {
      throw new AppError('INVALID_STOCK_QUANTITY', 'La cantidad de movimiento no es válida.', 400);
    }

    const current = await repo.findInventoryByProduct(c, companyId, productId);
    const previous = current?.quantity ?? 0;
    const next = previous + movement;

    if (next < 0) {
      throw new AppError('INSUFFICIENT_STOCK', 'No hay stock suficiente para registrar esa salida.', 409);
    }

    await repo.upsertInventoryStock(c, companyId, productId, next);
    await repo.addMovement(c, {
      companyId,
      productId,
      type,
      quantity: movement,
      stockAfter: next,
      reason,
      referenceType: type === 'AJUSTE' ? 'inventory_adjust' : null,
      referenceId,
      createdBy: actorId,
    });

    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'inventory.adjusted',
      ip: meta.ip,
      metadata: { productId, quantity: movement, type, reason, stockAfter: next },
    });

    return { productId: item.id, quantity: movement, type, stockAfter: next };
  });
}

export async function applyInventoryAdjustment(
  ctx: AuthContext,
  companyId: string,
  input: AdjustInventoryInput,
  meta: RequestMeta,
  actorId: string,
): Promise<{ productId: string; quantity: number; type: 'ENTRADA' | 'SALIDA' | 'AJUSTE'; stockAfter: number }> {
  return adjustStock(
    ctx,
    companyId,
    input.productId,
    input.quantity,
    input.type,
    input.reason ?? null,
    input.referenceId ?? null,
    meta,
    actorId,
  );
}
