import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import type { CreateSaleInput, ListSalesQuery } from './schema.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

interface SaleItemDto {
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface SaleDto {
  id: string;
  companyId: string;
  customerId: string | null;
  userId: string;
  status: 'COMPLETADA' | 'CANCELADA';
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  soldAt: Date;
  items: SaleItemDto[];
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const money = (valueInCents: number) => valueInCents / 100;

export async function createSale(
  ctx: AuthContext,
  companyId: string,
  actorId: string,
  input: CreateSaleInput,
  meta: RequestMeta,
): Promise<SaleDto> {
  const saleId = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId, userId: actorId }, async (c) => {
    const company = await c.query<{ currency: string }>(
      `SELECT currency FROM companies WHERE id = $1`,
      [companyId],
    );
    if (company.rowCount === 0) throw new AppError('COMPANY_NOT_FOUND', 'La empresa no existe.', 404);

    const paymentMethod = await c.query<{ id: string; code: string }>(
      `SELECT id, code FROM payment_methods WHERE company_id = $1 AND id = $2 AND is_active = true`,
      [companyId, input.paymentMethodId],
    );
    if (paymentMethod.rowCount === 0) {
      throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'El método de pago no existe o está inactivo.', 400);
    }

    const settingsResult = await c.query<{ data: { requireCustomerOnSale?: boolean; requirePaymentReference?: boolean } | null }>(
      `SELECT data FROM company_settings WHERE company_id = $1`,
      [companyId],
    );
    const settings = settingsResult.rows[0]?.data;
    if (settings?.requireCustomerOnSale && !input.customerId) {
      throw new AppError('CUSTOMER_REQUIRED', 'La configuración de la empresa exige seleccionar un cliente.', 400);
    }
    if (settings?.requirePaymentReference && !input.paymentReference?.trim()) {
      throw new AppError('PAYMENT_REFERENCE_REQUIRED', 'La configuración de la empresa exige una referencia de pago.', 400);
    }

    if (input.customerId) {
      const customer = await c.query<{ id: string }>(
        `SELECT id FROM customers WHERE company_id = $1 AND id = $2 AND is_active = true`,
        [companyId, input.customerId],
      );
      if (customer.rowCount === 0) throw new AppError('CUSTOMER_NOT_FOUND', 'El cliente no existe o está inactivo.', 404);
    }

    if (paymentMethod.rows[0]!.code === 'EFECTIVO' && !input.cashSessionId) {
      throw new AppError('CASH_SESSION_REQUIRED', 'Abre un turno de caja antes de cobrar en efectivo.', 409);
    }

    if (input.cashSessionId) {
      const session = await c.query<{ id: string; opened_by: string }>(
        `SELECT id, opened_by FROM cash_sessions WHERE company_id = $1 AND id = $2 AND status = 'ABIERTA' FOR UPDATE`,
        [companyId, input.cashSessionId],
      );
      if (session.rowCount === 0) throw new AppError('CASH_SESSION_NOT_OPEN', 'El turno de caja no existe o está cerrado.', 409);
      if (session.rows[0]!.opened_by !== actorId) {
        throw new AppError('CASH_SESSION_NOT_OWNED', 'El turno de caja pertenece a otro usuario.', 403);
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

    const productById = new Map(products.rows.map((product) => [product.id, product]));
    if (productById.size !== input.items.length) {
      throw new AppError('PRODUCT_NOT_FOUND', 'Uno o más productos no existen en esta empresa.', 404);
    }

    const preparedItems: Array<SaleItemDto & { grossCents: number; discountCents: number; taxCents: number }> = [];
    let subtotalCents = 0;
    let discountTotalCents = 0;
    let taxTotalCents = 0;

    for (const line of input.items) {
      const product = productById.get(line.productId)!;
      if (!product.is_active) throw new AppError('PRODUCT_INACTIVE', `El producto "${product.name}" está inactivo.`, 409);
      const unitPriceCents = cents(Number(product.price));
      const grossCents = Math.round(unitPriceCents * line.quantity);
      const discountCents = cents(line.discount);
      if (discountCents > grossCents) {
        throw new AppError('INVALID_DISCOUNT', `El descuento excede el importe de "${product.name}".`, 400);
      }

      const taxRate = Number(product.tax_rate);
      const taxCents = Math.round((grossCents - discountCents) * taxRate / 100);
      const lineTotalCents = grossCents - discountCents + taxCents;

      preparedItems.push({
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        quantity: line.quantity,
        unitPrice: money(unitPriceCents),
        discount: money(discountCents),
        taxRate,
        taxAmount: money(taxCents),
        lineTotal: money(lineTotalCents),
        grossCents,
        discountCents,
        taxCents,
      });
      subtotalCents += grossCents;
      discountTotalCents += discountCents;
      taxTotalCents += taxCents;
    }

    const totalCents = subtotalCents - discountTotalCents + taxTotalCents;
    if (totalCents <= 0) throw new AppError('INVALID_SALE_TOTAL', 'El total de la venta debe ser mayor que cero.', 400);

    for (const line of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = productById.get(line.productId)!;
      if (!product.track_stock) continue;
      await c.query(
        `INSERT INTO inventory_stock (company_id, product_id, quantity) VALUES ($1, $2, 0)
         ON CONFLICT (product_id) DO NOTHING`,
        [companyId, line.productId],
      );
      const stock = await c.query<{ quantity: string }>(
        `SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2 FOR UPDATE`,
        [companyId, line.productId],
      );
      const available = Number(stock.rows[0]?.quantity ?? 0);
      if (available < line.quantity) {
        throw new AppError('INSUFFICIENT_STOCK', `Existencias insuficientes para "${product.name}".`, 409, {
          productId: product.id,
          available,
          requested: line.quantity,
        });
      }
      const after = available - line.quantity;
      await c.query(
        `UPDATE inventory_stock SET quantity = $3, updated_at = now() WHERE company_id = $1 AND product_id = $2`,
        [companyId, line.productId, after],
      );
      await c.query(
        `INSERT INTO inventory_movements (company_id, product_id, type, quantity, stock_after, reason, reference_type, reference_id, created_by)
         VALUES ($1, $2, 'SALIDA', $3, $4, 'Venta', 'sale', $5, $6)`,
        [companyId, line.productId, -line.quantity, after, saleId, actorId],
      );
    }

    const currency = company.rows[0]!.currency;
    await c.query(
      `INSERT INTO sales (id, company_id, cash_session_id, customer_id, user_id, subtotal, discount_total, tax_total, total, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [saleId, companyId, input.cashSessionId ?? null, input.customerId ?? null, actorId, money(subtotalCents), money(discountTotalCents), money(taxTotalCents), money(totalCents), currency, input.notes ?? null],
    );

    for (const line of preparedItems) {
      await c.query(
        `INSERT INTO sale_items (company_id, sale_id, product_id, product_sku, product_name, quantity, unit_price, discount, tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [companyId, saleId, line.productId, line.productSku, line.productName, line.quantity, line.unitPrice, line.discount, line.taxRate, line.taxAmount, line.lineTotal],
      );
    }

    await c.query(
      `INSERT INTO payments (company_id, sale_id, payment_method_id, amount, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [companyId, saleId, input.paymentMethodId, money(totalCents), input.paymentReference ?? null, actorId],
    );

    if (paymentMethod.rows[0]!.code === 'EFECTIVO') {
      await c.query(
        `INSERT INTO cash_movements (company_id, cash_session_id, type, amount, reason, created_by)
         VALUES ($1,$2,'INGRESO',$3,$4,$5)`,
        [companyId, input.cashSessionId, money(totalCents), `Venta ${saleId}`, actorId],
      );
    }

    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'sale.created',
      ip: meta.ip,
      metadata: { saleId, total: money(totalCents), itemCount: preparedItems.length },
    });

    return {
      id: saleId,
      companyId,
      customerId: input.customerId ?? null,
      userId: actorId,
      status: 'COMPLETADA',
      subtotal: money(subtotalCents),
      discountTotal: money(discountTotalCents),
      taxTotal: money(taxTotalCents),
      total: money(totalCents),
      currency,
      soldAt: new Date(),
      items: preparedItems.map(({ grossCents: _gross, discountCents: _discount, taxCents: _tax, ...item }) => item),
    };
  });
}

export async function listSales(
  ctx: AuthContext,
  companyId: string,
  query: ListSalesQuery,
): Promise<{ items: Array<{ id: string; customer_id: string | null; user_id: string; status: string; subtotal: number; discount_total: number; tax_total: number; total: number; currency: string; sold_at: Date }>; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page);
  const limit = Math.min(Math.max(1, query.limit), 100);
  const where: string[] = ['company_id = $1'];
  const args: unknown[] = [companyId];
  if (query.status) { args.push(query.status); where.push(`status = $${args.length}`); }
  if (query.from) { args.push(query.from); where.push(`sold_at >= $${args.length}`); }
  if (query.to) { args.push(query.to); where.push(`sold_at < $${args.length}`); }

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const rows = await c.query<{ id: string; customer_id: string | null; user_id: string; status: string; subtotal: string; discount_total: string; tax_total: string; total: string; currency: string; sold_at: Date }>(
      `SELECT id, customer_id, user_id, status, subtotal::text, discount_total::text, tax_total::text, total::text, currency, sold_at
         FROM sales WHERE ${where.join(' AND ')} ORDER BY sold_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, (page - 1) * limit],
    );
    const count = await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM sales WHERE ${where.join(' AND ')}`, args);
    return {
      items: rows.rows.map((row) => ({ ...row, subtotal: Number(row.subtotal), discount_total: Number(row.discount_total), tax_total: Number(row.tax_total), total: Number(row.total) })),
      total: Number(count.rows[0]?.count ?? 0),
      page,
      limit,
    };
  });
}

export async function cancelSale(
  ctx: AuthContext,
  companyId: string,
  saleId: string,
  actorId: string,
  input: { reason: string; refundReference?: string | null },
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const saleResult = await c.query<{ id: string; status: 'COMPLETADA' | 'CANCELADA'; cash_session_id: string | null }>(
      `SELECT id, status, cash_session_id FROM sales WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [companyId, saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale) throw new AppError('SALE_NOT_FOUND', 'La venta no existe.', 404);
    if (sale.status !== 'COMPLETADA') throw new AppError('SALE_ALREADY_CANCELLED', 'La venta ya está cancelada.', 409);

    const invoice = await c.query<{ status: 'EMITIDA' | 'ANULADA' }>(
      `SELECT status FROM invoices WHERE company_id = $1 AND sale_id = $2`,
      [companyId, saleId],
    );
    if (invoice.rows.some((row) => row.status === 'EMITIDA')) {
      throw new AppError('INVOICE_MUST_BE_CANCELLED', 'Anula primero la factura asociada a esta venta.', 409);
    }

    const payments = await c.query<{ id: string; amount: string; code: string }>(
      `SELECT p.id, p.amount::text, pm.code
         FROM payments p JOIN payment_methods pm ON pm.company_id = p.company_id AND pm.id = p.payment_method_id
        WHERE p.company_id = $1 AND p.sale_id = $2 ORDER BY p.id`,
      [companyId, saleId],
    );
    if (payments.rowCount === 0) throw new AppError('PAYMENT_NOT_FOUND', 'La venta no tiene pagos registrados.', 409);
    const cashPayments = payments.rows.filter((payment) => payment.code === 'EFECTIVO');
    const externalPayments = payments.rows.filter((payment) => payment.code !== 'EFECTIVO');
    if (externalPayments.length > 0 && !input.refundReference?.trim()) {
      throw new AppError('REFUND_REFERENCE_REQUIRED', 'Registra la referencia del reembolso externo antes de cancelar.', 400);
    }
    if (cashPayments.length > 0) {
      if (!sale.cash_session_id) throw new AppError('CASH_SESSION_REQUIRED', 'No se puede revertir efectivo sin la caja de origen.', 409);
      const session = await c.query<{ id: string }>(
        `SELECT id FROM cash_sessions WHERE company_id = $1 AND id = $2 AND status = 'ABIERTA' FOR UPDATE`,
        [companyId, sale.cash_session_id],
      );
      if (!session.rowCount) throw new AppError('CASH_SESSION_NOT_OPEN', 'Abre caja para registrar la devolución en efectivo.', 409);
    }

    const items = await c.query<{ product_id: string; quantity: string; track_stock: boolean; name: string }>(
      `SELECT si.product_id, si.quantity::text, p.track_stock, p.name
         FROM sale_items si JOIN products p ON p.company_id = si.company_id AND p.id = si.product_id
        WHERE si.company_id = $1 AND si.sale_id = $2 ORDER BY si.product_id FOR UPDATE OF p`,
      [companyId, saleId],
    );
    for (const item of items.rows) {
      if (!item.track_stock) continue;
      await c.query(
        `INSERT INTO inventory_stock (company_id, product_id, quantity) VALUES ($1,$2,0)
         ON CONFLICT (product_id) DO NOTHING`,
        [companyId, item.product_id],
      );
      const stock = await c.query<{ quantity: string }>(
        `SELECT quantity::text FROM inventory_stock WHERE company_id = $1 AND product_id = $2 FOR UPDATE`,
        [companyId, item.product_id],
      );
      const after = Number(stock.rows[0]?.quantity ?? 0) + Number(item.quantity);
      await c.query(
        `UPDATE inventory_stock SET quantity = $3, updated_at = now() WHERE company_id = $1 AND product_id = $2`,
        [companyId, item.product_id, after],
      );
      await c.query(
        `INSERT INTO inventory_movements (company_id, product_id, type, quantity, stock_after, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,'ENTRADA',$3,$4,$5,'sale_cancel',$6,$7)`,
        [companyId, item.product_id, Number(item.quantity), after, `Cancelación de venta: ${input.reason}`, saleId, actorId],
      );
    }

    for (const payment of payments.rows) {
      await c.query(
        `INSERT INTO payment_refunds (company_id, sale_id, payment_id, amount, reference, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, saleId, payment.id, Number(payment.amount), payment.code === 'EFECTIVO' ? null : input.refundReference ?? null, input.reason, actorId],
      );
      if (payment.code === 'EFECTIVO') {
        await c.query(
          `INSERT INTO cash_movements (company_id, cash_session_id, type, amount, reason, created_by)
           VALUES ($1,$2,'EGRESO',$3,$4,$5)`,
          [companyId, sale.cash_session_id, Number(payment.amount), `Devolución venta ${saleId}: ${input.reason}`, actorId],
        );
      }
    }

    await c.query(
      `UPDATE sales SET status = 'CANCELADA', canceled_at = now(), canceled_by = $3, cancel_reason = $4
        WHERE company_id = $1 AND id = $2`,
      [companyId, saleId, actorId, input.reason],
    );
    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'sale.cancelled',
      ip: meta.ip,
      metadata: { saleId, reason: input.reason, refundReference: input.refundReference ?? null },
    });
  });
}
