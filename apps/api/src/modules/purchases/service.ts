import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import type { CreatePurchaseInput, ListPurchasesQuery } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface PurchaseItemDto {
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface PurchaseDto {
  id: string;
  companyId: string;
  supplierId: string;
  paymentMethodId: string | null;
  userId: string;
  status: 'RECIBIDA' | 'ANULADA';
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  receivedAt: Date;
  items: PurchaseItemDto[];
}

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
const money = (amount: number) => amount / 100;

export async function createPurchase(
  ctx: AuthContext,
  companyId: string,
  actorId: string,
  input: CreatePurchaseInput,
  meta: RequestMeta,
): Promise<PurchaseDto> {
  const purchaseId = randomUUID();
  return withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const supplier = await c.query<{ id: string }>(
      `SELECT id FROM suppliers WHERE company_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
      [companyId, input.supplierId],
    );
    if (!supplier.rowCount) throw new AppError('SUPPLIER_NOT_FOUND', 'El proveedor no existe o está inactivo.', 404);

    const company = await c.query<{ currency: string }>(`SELECT currency FROM companies WHERE id = $1`, [companyId]);
    if (!company.rowCount) throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);

    if (input.paymentMethodId) {
      const method = await c.query<{ id: string }>(
        `SELECT id FROM payment_methods
          WHERE company_id = $1 AND id = $2 AND is_active = true`,
        [companyId, input.paymentMethodId],
      );
      if (!method.rowCount) {
        throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'El método de pago no existe o está inactivo.', 404);
      }
    }

    const productIds = input.items.map((item) => item.productId).sort();
    const products = await c.query<{
      id: string;
      sku: string;
      name: string;
      price: string;
      track_stock: boolean;
      is_active: boolean;
      tax_rate: string;
    }>(
      `SELECT p.id, p.sku, p.name, p.price::text, p.track_stock, p.is_active,
              COALESCE(t.rate, 0)::text AS tax_rate
         FROM products p
         LEFT JOIN tax_rates t ON t.company_id = p.company_id AND t.id = p.tax_rate_id AND t.is_active = true
        WHERE p.company_id = $1 AND p.id = ANY($2::uuid[]) AND p.deleted_at IS NULL
        ORDER BY p.id FOR UPDATE OF p`,
      [companyId, productIds],
    );
    const productsById = new Map(products.rows.map((row) => [row.id, row]));
    if (productsById.size !== input.items.length) throw new AppError('PRODUCT_NOT_FOUND', 'Uno o más productos no existen en esta empresa.', 404);

    const lines: Array<PurchaseItemDto & { grossCents: number; taxCents: number }> = [];
    let subtotalCents = 0;
    let taxTotalCents = 0;
    for (const inputLine of input.items) {
      const product = productsById.get(inputLine.productId)!;
      if (!product.is_active) throw new AppError('PRODUCT_INACTIVE', `El producto "${product.name}" está inactivo.`, 409);
      if (!product.track_stock) throw new AppError('PRODUCT_NO_STOCK_TRACKING', `El producto "${product.name}" no maneja existencias.`, 400);
      const unitCostCents = cents(inputLine.unitCost);
      const grossCents = Math.round(unitCostCents * inputLine.quantity);
      const taxRate = Number(product.tax_rate);
      const taxCents = Math.round(grossCents * taxRate / 100);
      lines.push({
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        quantity: inputLine.quantity,
        unitCost: money(unitCostCents),
        taxRate,
        taxAmount: money(taxCents),
        lineTotal: money(grossCents + taxCents),
        grossCents,
        taxCents,
      });
      subtotalCents += grossCents;
      taxTotalCents += taxCents;
    }

    const totalCents = subtotalCents + taxTotalCents;
    const currency = company.rows[0]!.currency;
    await c.query(
      `INSERT INTO purchases (id, company_id, supplier_id, payment_method_id, user_id, subtotal, tax_total, total, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [purchaseId, companyId, input.supplierId, input.paymentMethodId ?? null, actorId, money(subtotalCents), money(taxTotalCents), money(totalCents), currency, input.notes ?? null],
    );

    for (const line of lines) {
      await c.query(
        `INSERT INTO purchase_items (company_id, purchase_id, product_id, product_sku, product_name, quantity, unit_cost, tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [companyId, purchaseId, line.productId, line.productSku, line.productName, line.quantity, line.unitCost, line.taxRate, line.taxAmount, line.lineTotal],
      );
      await c.query(
        `INSERT INTO inventory_stock (company_id, product_id, quantity) VALUES ($1,$2,0)
         ON CONFLICT (product_id) DO NOTHING`,
        [companyId, line.productId],
      );
      const stock = await c.query<{ quantity: string }>(
        `SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2 FOR UPDATE`,
        [companyId, line.productId],
      );
      const after = Number(stock.rows[0]?.quantity ?? 0) + line.quantity;
      await c.query(
        `UPDATE inventory_stock SET quantity = $3, updated_at = now() WHERE company_id = $1 AND product_id = $2`,
        [companyId, line.productId, after],
      );
      await c.query(
        `INSERT INTO inventory_movements (company_id, product_id, type, quantity, stock_after, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,'ENTRADA',$3,$4,'Recepción de compra','purchase',$5,$6)`,
        [companyId, line.productId, line.quantity, after, purchaseId, actorId],
      );
    }

    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'purchase.received',
      ip: meta.ip,
      metadata: { purchaseId, supplierId: input.supplierId, total: money(totalCents), itemCount: lines.length },
    });

    return {
      id: purchaseId,
      companyId,
      supplierId: input.supplierId,
      paymentMethodId: input.paymentMethodId ?? null,
      userId: actorId,
      status: 'RECIBIDA',
      subtotal: money(subtotalCents),
      taxTotal: money(taxTotalCents),
      total: money(totalCents),
      currency,
      receivedAt: new Date(),
      items: lines.map(({ grossCents: _gross, taxCents: _tax, ...line }) => line),
    };
  });
}

export async function listPurchases(
  ctx: AuthContext,
  companyId: string,
  query: ListPurchasesQuery,
): Promise<{ items: Array<{ id: string; supplier_id: string; supplier_name: string; payment_method_id: string | null; payment_method_name: string | null; status: string; subtotal: number; tax_total: number; total: number; currency: string; received_at: Date }>; total: number; page: number; limit: number }> {
  const args: unknown[] = [companyId];
  const where = ['p.company_id = $1'];
  if (query.status) {
    args.push(query.status);
    where.push(`p.status = $${args.length}`);
  }
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const rows = await c.query<{
      id: string; supplier_id: string; supplier_name: string; status: string;
      payment_method_id: string | null; payment_method_name: string | null;
      subtotal: string; tax_total: string; total: string; currency: string; received_at: Date;
    }>(
      `SELECT p.id, p.supplier_id, s.name AS supplier_name,
              p.payment_method_id, pm.name AS payment_method_name, p.status,
              p.subtotal::text, p.tax_total::text, p.total::text, p.currency, p.received_at
         FROM purchases p JOIN suppliers s ON s.company_id = p.company_id AND s.id = p.supplier_id
         LEFT JOIN payment_methods pm ON pm.company_id = p.company_id AND pm.id = p.payment_method_id
        WHERE ${where.join(' AND ')} ORDER BY p.received_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, query.limit, (query.page - 1) * query.limit],
    );
    const count = await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM purchases p WHERE ${where.join(' AND ')}`, args);
    return {
      items: rows.rows.map((row) => ({ ...row, subtotal: Number(row.subtotal), tax_total: Number(row.tax_total), total: Number(row.total) })),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      limit: query.limit,
    };
  });
}

export async function cancelPurchase(
  ctx: AuthContext,
  companyId: string,
  purchaseId: string,
  actorId: string,
  reason: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const purchase = await c.query<{ id: string; status: 'RECIBIDA' | 'ANULADA' }>(
      `SELECT id, status FROM purchases WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [companyId, purchaseId],
    );
    const row = purchase.rows[0];
    if (!row) throw new AppError('PURCHASE_NOT_FOUND', 'La compra no existe.', 404);
    if (row.status !== 'RECIBIDA') throw new AppError('PURCHASE_ALREADY_CANCELLED', 'La compra ya fue anulada.', 409);

    const items = await c.query<{ product_id: string; quantity: string; track_stock: boolean; name: string }>(
      `SELECT pi.product_id, pi.quantity::text, p.track_stock, p.name
         FROM purchase_items pi JOIN products p ON p.company_id = pi.company_id AND p.id = pi.product_id
        WHERE pi.company_id = $1 AND pi.purchase_id = $2 ORDER BY pi.product_id FOR UPDATE OF p`,
      [companyId, purchaseId],
    );
    for (const item of items.rows) {
      if (!item.track_stock) throw new AppError('PURCHASE_PRODUCT_CHANGED', `El producto "${item.name}" ya no controla existencias.`, 409);
      const stock = await c.query<{ quantity: string }>(
        `SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2 FOR UPDATE`,
        [companyId, item.product_id],
      );
      const available = Number(stock.rows[0]?.quantity ?? 0);
      const quantity = Number(item.quantity);
      if (available < quantity) {
        throw new AppError('PURCHASE_STOCK_ALREADY_CONSUMED', `No se puede anular: parte de las existencias de "${item.name}" ya se consumió.`, 409);
      }
      const after = available - quantity;
      await c.query(
        `UPDATE inventory_stock SET quantity = $3, updated_at = now() WHERE company_id = $1 AND product_id = $2`,
        [companyId, item.product_id, after],
      );
      await c.query(
        `INSERT INTO inventory_movements (company_id, product_id, type, quantity, stock_after, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,'SALIDA',$3,$4,$5,'purchase_cancel',$6,$7)`,
        [companyId, item.product_id, -quantity, after, reason, purchaseId, actorId],
      );
    }

    await c.query(
      `UPDATE purchases SET status = 'ANULADA', canceled_at = now(), cancel_reason = $3 WHERE company_id = $1 AND id = $2`,
      [companyId, purchaseId, reason],
    );
    await insertAudit(c, { companyId, userId: actorId, action: 'purchase.cancelled', ip: meta.ip, metadata: { purchaseId, reason } });
  });
}
