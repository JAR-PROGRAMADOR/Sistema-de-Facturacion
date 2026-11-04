import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import * as repo from './repository.js';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type Product = repo.ProductRow;

export interface ProductDto {
  id: string;
  companyId: string;
  categoryId: string | null;
  taxRateId: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  type: 'BIEN' | 'SERVICIO';
  price: number;
  cost: number | null;
  trackStock: boolean;
  minStock: number;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toProductDto(row: repo.ProductRow): ProductDto {
  return {
    id: row.id,
    companyId: row.company_id,
    categoryId: row.category_id,
    taxRateId: row.tax_rate_id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    description: row.description,
    type: row.type,
    price: Number(row.price),
    cost: row.cost === null ? null : Number(row.cost),
    trackStock: row.track_stock,
    minStock: Number(row.min_stock),
    isActive: row.is_active,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProducts(
  ctx: AuthContext,
  companyId: string,
  query: ListProductsQuery,
): Promise<{ items: ProductDto[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const offset = (page - 1) * limit;

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listProducts(c, companyId, {
        limit,
        offset,
        search: query.search,
        categoryId: query.categoryId,
        active: query.active,
      }).then((rows) => rows.map(toProductDto)),
      repo.countProducts(c, companyId, {
        search: query.search,
        categoryId: query.categoryId,
        active: query.active,
      }),
    ]);

    return { items, total, page, limit };
  });
}

export async function getProduct(
  ctx: AuthContext,
  companyId: string,
  productId: string,
): Promise<ProductDto> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const item = await repo.findProductById(c, companyId, productId);
    if (!item) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }
    return toProductDto(item);
  });
}

export async function createProduct(
  ctx: AuthContext,
  companyId: string,
  input: CreateProductInput,
  meta: RequestMeta,
): Promise<ProductDto> {
  const id = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    if (input.categoryId) {
      const category = await c.query<{ id: string }>(
        `SELECT id FROM categories WHERE company_id = $1 AND id = $2`,
        [companyId, input.categoryId],
      );
      if (category.rowCount === 0) {
        throw new AppError('CATEGORY_NOT_FOUND', 'La categoría indicada no existe.', 404);
      }
    }

    if (await repo.skuExists(c, companyId, input.sku)) {
      throw new AppError('PRODUCT_DUPLICATE_SKU', 'Ya existe otro producto con ese SKU.', 409);
    }

    if (input.type === 'SERVICIO' && input.trackStock !== false) {
      throw new AppError('INVALID_PRODUCT_TYPE', 'Los servicios no pueden llevar seguimiento de stock.', 400);
    }

    await repo.insertProduct(c, {
      id,
      companyId,
      categoryId: input.categoryId ?? null,
      taxRateId: input.taxRateId ?? null,
      sku: input.sku,
      barcode: input.barcode ?? null,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      price: input.price,
      cost: input.cost ?? null,
      trackStock: input.trackStock ?? true,
      minStock: input.minStock ?? 0,
      isActive: input.isActive ?? true,
    });

    if ((input.trackStock ?? true) && (input.initialStock ?? 0) > 0) {
      await c.query(
        `INSERT INTO inventory_stock (company_id, product_id, quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [companyId, id, input.initialStock],
      );
      await c.query(
        `INSERT INTO inventory_movements (id, company_id, product_id, type, quantity, stock_after, reason, reference_type, reference_id, created_by)
          VALUES (gen_random_uuid(), $1, $2, 'ENTRADA', $3, $3, 'Alta de inventario inicial', 'product_initial_stock', $2, '00000000-0000-0000-0000-000000000000')`,
        [companyId, id, input.initialStock],
      );
    }

    await insertAudit(c, {
      companyId,
      action: 'product.created',
      ip: meta.ip,
      metadata: { productId: id, sku: input.sku, name: input.name },
    });

    const created = await repo.findProductById(c, companyId, id);
    if (!created) {
      throw new AppError('INTERNAL_ERROR', 'No fue posible crear el producto.', 500);
    }

    return toProductDto(created);
  });
}

export async function updateProduct(
  ctx: AuthContext,
  companyId: string,
  productId: string,
  input: UpdateProductInput,
  meta: RequestMeta,
): Promise<ProductDto> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findProductById(c, companyId, productId);
    if (!current) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }

    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await c.query<{ id: string }>(
        `SELECT id FROM categories WHERE company_id = $1 AND id = $2`,
        [companyId, input.categoryId],
      );
      if (category.rowCount === 0) {
        throw new AppError('CATEGORY_NOT_FOUND', 'La categoría indicada no existe.', 404);
      }
    }

    if (input.sku && input.sku !== current.sku && await repo.skuExists(c, companyId, input.sku, productId)) {
      throw new AppError('PRODUCT_DUPLICATE_SKU', 'Ya existe otro producto con ese SKU.', 409);
    }

    if (input.type === 'SERVICIO' && input.trackStock !== false && current.track_stock) {
      throw new AppError('INVALID_PRODUCT_TYPE', 'Los servicios no pueden llevar seguimiento de stock.', 400);
    }

    const patch: {
      category_id?: string | null;
      tax_rate_id?: string | null;
      sku?: string;
      barcode?: string | null;
      name?: string;
      description?: string | null;
      type?: 'BIEN' | 'SERVICIO';
      price?: number;
      cost?: number | null;
      track_stock?: boolean;
      min_stock?: number;
      is_active?: boolean;
    } = {};

    if (input.categoryId !== undefined) patch.category_id = input.categoryId ?? null;
    if (input.taxRateId !== undefined) patch.tax_rate_id = input.taxRateId ?? null;
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.barcode !== undefined) patch.barcode = input.barcode ?? null;
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.type !== undefined) patch.type = input.type;
    if (input.price !== undefined) patch.price = Number(input.price);
    if (input.cost !== undefined) patch.cost = input.cost ?? null;
    if (input.trackStock !== undefined) patch.track_stock = input.trackStock;
    if (input.minStock !== undefined) patch.min_stock = Number(input.minStock);
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    if (Object.keys(patch).length > 0) {
      await repo.updateProduct(c, companyId, productId, patch);
    }

    await insertAudit(c, {
      companyId,
      action: 'product.updated',
      ip: meta.ip,
      metadata: { productId, patch },
    });

    const updated = await repo.findProductById(c, companyId, productId);
    if (!updated) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }

    return toProductDto(updated);
  });
}

export async function deleteProduct(
  ctx: AuthContext,
  companyId: string,
  productId: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findProductById(c, companyId, productId);
    if (!current) {
      throw new AppError('PRODUCT_NOT_FOUND', 'El producto no existe.', 404);
    }

    await repo.softDeleteProduct(c, companyId, productId);

    await insertAudit(c, {
      companyId,
      action: 'product.deleted',
      ip: meta.ip,
      metadata: { productId },
    });
  });
}
