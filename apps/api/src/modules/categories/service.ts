import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import * as repo from './repository.js';
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type Category = repo.CategoryRow;

export async function listCategories(
  ctx: AuthContext,
  companyId: string,
  query: ListCategoriesQuery,
): Promise<{ items: Category[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
  const offset = (page - 1) * limit;

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const [items, total] = await Promise.all([
      repo.listCategories(c, companyId, { limit, offset, search: query.search, active: query.active }),
      repo.countCategories(c, companyId, { search: query.search, active: query.active }),
    ]);

    return { items, total, page, limit };
  });
}

export async function getCategory(
  ctx: AuthContext,
  companyId: string,
  categoryId: string,
): Promise<Category> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const item = await repo.findCategoryById(c, companyId, categoryId);
    if (!item) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría no existe.', 404);
    }
    return item;
  });
}

export async function createCategory(
  ctx: AuthContext,
  companyId: string,
  input: CreateCategoryInput,
  meta: RequestMeta,
): Promise<Category> {
  const id = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    if (await repo.categoryNameExists(c, companyId, input.name)) {
      throw new AppError('CATEGORY_DUPLICATE', 'Ya existe una categoría con ese nombre.', 409);
    }

    await repo.insertCategory(c, {
      id,
      companyId,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    });

    await insertAudit(c, {
      companyId,
      action: 'category.created',
      ip: meta.ip,
      metadata: { categoryId: id, name: input.name },
    });

    const created = await repo.findCategoryById(c, companyId, id);
    if (!created) {
      throw new AppError('INTERNAL_ERROR', 'No fue posible crear la categoría.', 500);
    }

    return created;
  });
}

export async function updateCategory(
  ctx: AuthContext,
  companyId: string,
  categoryId: string,
  input: UpdateCategoryInput,
  meta: RequestMeta,
): Promise<Category> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findCategoryById(c, companyId, categoryId);
    if (!current) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría no existe.', 404);
    }

    if (input.name && input.name !== current.name && await repo.categoryNameExists(c, companyId, input.name, categoryId)) {
      throw new AppError('CATEGORY_DUPLICATE', 'Ya existe otra categoría con ese nombre.', 409);
    }

    const patch: { name?: string; description?: string | null; is_active?: boolean } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    if (Object.keys(patch).length > 0) {
      await repo.updateCategory(c, companyId, categoryId, patch);
    }

    await insertAudit(c, {
      companyId,
      action: 'category.updated',
      ip: meta.ip,
      metadata: { categoryId, patch },
    });

    const updated = await repo.findCategoryById(c, companyId, categoryId);
    if (!updated) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría no existe.', 404);
    }

    return updated;
  });
}

export async function deleteCategory(
  ctx: AuthContext,
  companyId: string,
  categoryId: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const current = await repo.findCategoryById(c, companyId, categoryId);
    if (!current) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría no existe.', 404);
    }

    const inUse = await c.query<{ row_count: number }>(
      `SELECT count(*)::int AS row_count FROM products WHERE company_id = $1 AND category_id = $2 AND deleted_at IS NULL`,
      [companyId, categoryId],
    );

    if ((inUse.rows[0]?.row_count ?? 0) > 0) {
      throw new AppError('CATEGORY_IN_USE', 'No puedes eliminar una categoría con productos asociados.', 409);
    }

    await repo.deleteCategory(c, companyId, categoryId);

    await insertAudit(c, {
      companyId,
      action: 'category.deleted',
      ip: meta.ip,
      metadata: { categoryId },
    });
  });
}
