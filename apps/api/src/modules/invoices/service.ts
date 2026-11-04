import { randomUUID } from 'node:crypto';
import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

interface InvoiceItem {
  id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  company_id: string;
  sale_id: string;
  series_id: string;
  number: number;
  full_number: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  customer_address: string | null;
  status: 'EMITIDA' | 'ANULADA';
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  currency: string;
  issued_at: Date;
  items: InvoiceItem[];
}

export interface InvoiceDocument extends Omit<Invoice, 'items'> {
  company_name: string;
  company_legal_name: string | null;
  company_tax_id: string | null;
  company_country: string | null;
  items: InvoiceItem[];
}

export async function getInvoice(
  ctx: AuthContext,
  companyId: string,
  invoiceId: string,
): Promise<InvoiceDocument> {
  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const result = await c.query<{
      id: string;
      company_id: string;
      sale_id: string;
      series_id: string;
      number: string;
      full_number: string;
      customer_id: string | null;
      customer_name: string | null;
      customer_tax_id: string | null;
      customer_address: string | null;
      status: 'EMITIDA' | 'ANULADA';
      subtotal: string;
      discount_total: string;
      tax_total: string;
      total: string;
      currency: string;
      issued_at: Date;
      company_name: string;
      company_legal_name: string | null;
      company_tax_id: string | null;
      company_country: string | null;
    }>(
      `SELECT i.id, i.company_id, i.sale_id, i.series_id, i.number::text, i.full_number,
              i.customer_id, i.customer_name, i.customer_tax_id, i.customer_address,
              i.status, i.subtotal::text, i.discount_total::text, i.tax_total::text,
              i.total::text, i.currency, i.issued_at, c.name AS company_name,
              c.legal_name AS company_legal_name, c.tax_id AS company_tax_id,
              c.country AS company_country
         FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE i.company_id = $1 AND i.id = $2`,
      [companyId, invoiceId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('INVOICE_NOT_FOUND', 'La factura no existe.', 404);

    const itemResult = await c.query<{
      id: string;
      product_id: string | null;
      description: string;
      quantity: string;
      unit_price: string;
      discount: string;
      tax_rate: string;
      tax_amount: string;
      line_total: string;
    }>(
      `SELECT id, product_id, description, quantity::text, unit_price::text,
              discount::text, tax_rate::text, tax_amount::text, line_total::text
         FROM invoice_items WHERE company_id = $1 AND invoice_id = $2 ORDER BY id`,
      [companyId, invoiceId],
    );

    return {
      ...row,
      number: Number(row.number),
      subtotal: Number(row.subtotal),
      discount_total: Number(row.discount_total),
      tax_total: Number(row.tax_total),
      total: Number(row.total),
      items: itemResult.rows.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount: Number(item.discount),
        tax_rate: Number(item.tax_rate),
        tax_amount: Number(item.tax_amount),
        line_total: Number(item.line_total),
      })),
    };
  });
}

export async function issueInvoice(
  ctx: AuthContext,
  companyId: string,
  saleId: string,
  actorId: string,
  meta: RequestMeta,
): Promise<Invoice> {
  const invoiceId = randomUUID();

  return withContext(ctx.pool, { platform: true, companyId, userId: actorId }, async (c) => {
    const saleResult = await c.query<{
      id: string;
      customer_id: string | null;
      customer_name: string | null;
      customer_tax_id: string | null;
      customer_address: string | null;
      status: string;
      subtotal: string;
      discount_total: string;
      tax_total: string;
      total: string;
      currency: string;
    }>(
      `SELECT s.id, s.customer_id, cu.name AS customer_name, cu.tax_id AS customer_tax_id,
              cu.address AS customer_address, s.status, s.subtotal::text, s.discount_total::text,
              s.tax_total::text, s.total::text, s.currency
         FROM sales s
         LEFT JOIN customers cu ON cu.company_id = s.company_id AND cu.id = s.customer_id
        WHERE s.company_id = $1 AND s.id = $2 FOR UPDATE OF s`,
      [companyId, saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale) throw new AppError('SALE_NOT_FOUND', 'La venta no existe.', 404);
    if (sale.status !== 'COMPLETADA') throw new AppError('SALE_NOT_INVOICABLE', 'Solo se pueden facturar ventas completadas.', 409);

    const existing = await c.query<{ id: string }>(
      `SELECT id FROM invoices WHERE company_id = $1 AND sale_id = $2`,
      [companyId, saleId],
    );
    if (existing.rowCount) throw new AppError('INVOICE_ALREADY_EXISTS', 'Esta venta ya tiene una factura.', 409);

    const series = await c.query<{ id: string; code: string; prefix: string }>(
      `SELECT id, code, prefix FROM invoice_series WHERE company_id = $1 AND is_default = true FOR UPDATE`,
      [companyId],
    );
    const selectedSeries = series.rows[0];
    if (!selectedSeries) throw new AppError('INVOICE_SERIES_NOT_CONFIGURED', 'La empresa no tiene una serie de facturación predeterminada.', 409);

    const numberResult = await c.query<{ number: string }>(
      `SELECT next_invoice_number($1)::text AS number`,
      [selectedSeries.id],
    );
    const number = Number(numberResult.rows[0]?.number);
    if (!Number.isInteger(number) || number < 1) throw new AppError('INVOICE_NUMBER_ERROR', 'No fue posible reservar el número de factura.', 500);
    const fullNumber = `${selectedSeries.prefix || `${selectedSeries.code}-`}${String(number).padStart(6, '0')}`;

    const itemsResult = await c.query<{
      product_id: string;
      product_name: string;
      quantity: string;
      unit_price: string;
      discount: string;
      tax_rate: string;
      tax_amount: string;
      line_total: string;
    }>(
      `SELECT product_id, product_name, quantity::text, unit_price::text, discount::text,
              tax_rate::text, tax_amount::text, line_total::text
         FROM sale_items WHERE company_id = $1 AND sale_id = $2 ORDER BY id`,
      [companyId, saleId],
    );

    await c.query(
      `INSERT INTO invoices (id, company_id, sale_id, series_id, number, full_number, customer_id,
          customer_name, customer_tax_id, customer_address, subtotal, discount_total, tax_total, total, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [invoiceId, companyId, saleId, selectedSeries.id, number, fullNumber, sale.customer_id, sale.customer_name, sale.customer_tax_id, sale.customer_address, Number(sale.subtotal), Number(sale.discount_total), Number(sale.tax_total), Number(sale.total), sale.currency],
    );

    const items: InvoiceItem[] = [];
    for (const line of itemsResult.rows) {
      const itemId = randomUUID();
      const item = {
        id: itemId,
        product_id: line.product_id,
        description: line.product_name,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        discount: Number(line.discount),
        tax_rate: Number(line.tax_rate),
        tax_amount: Number(line.tax_amount),
        line_total: Number(line.line_total),
      };
      await c.query(
        `INSERT INTO invoice_items (id, company_id, invoice_id, product_id, description, quantity, unit_price, discount, tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [item.id, companyId, invoiceId, item.product_id, item.description, item.quantity, item.unit_price, item.discount, item.tax_rate, item.tax_amount, item.line_total],
      );
      items.push(item);
    }

    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'invoice.issued',
      ip: meta.ip,
      metadata: { invoiceId, saleId, fullNumber, total: Number(sale.total) },
    });

    return {
      id: invoiceId,
      company_id: companyId,
      sale_id: saleId,
      series_id: selectedSeries.id,
      number,
      full_number: fullNumber,
      customer_id: sale.customer_id,
      customer_name: sale.customer_name,
      customer_tax_id: sale.customer_tax_id,
      customer_address: sale.customer_address,
      status: 'EMITIDA',
      subtotal: Number(sale.subtotal),
      discount_total: Number(sale.discount_total),
      tax_total: Number(sale.tax_total),
      total: Number(sale.total),
      currency: sale.currency,
      issued_at: new Date(),
      items,
    };
  });
}

export async function listInvoices(
  ctx: AuthContext,
  companyId: string,
  query: { page: number; limit: number; status?: 'EMITIDA' | 'ANULADA' },
): Promise<{ items: Omit<Invoice, 'items'>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page);
  const limit = Math.min(Math.max(1, query.limit), 100);
  const where = ['company_id = $1'];
  const args: unknown[] = [companyId];
  if (query.status) { args.push(query.status); where.push(`status = $${args.length}`); }

  return withContext(ctx.pool, { platform: true, companyId }, async (c) => {
    const rows = await c.query<{
      id: string; company_id: string; sale_id: string; series_id: string; number: string; full_number: string;
      customer_id: string | null; customer_name: string | null; customer_tax_id: string | null; customer_address: string | null;
      status: 'EMITIDA' | 'ANULADA'; subtotal: string; discount_total: string; tax_total: string; total: string;
      currency: string; issued_at: Date;
    }>(
      `SELECT id, company_id, sale_id, series_id, number::text, full_number, customer_id, customer_name,
              customer_tax_id, customer_address, status, subtotal::text, discount_total::text, tax_total::text,
              total::text, currency, issued_at
         FROM invoices WHERE ${where.join(' AND ')} ORDER BY issued_at DESC
         LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, (page - 1) * limit],
    );
    const count = await c.query<{ count: string }>(`SELECT count(*)::text AS count FROM invoices WHERE ${where.join(' AND ')}`, args);
    return {
      items: rows.rows.map((row) => ({
        ...row,
        number: Number(row.number),
        subtotal: Number(row.subtotal),
        discount_total: Number(row.discount_total),
        tax_total: Number(row.tax_total),
        total: Number(row.total),
      })),
      total: Number(count.rows[0]?.count ?? 0),
      page,
      limit,
    };
  });
}

export async function cancelInvoice(
  ctx: AuthContext,
  companyId: string,
  invoiceId: string,
  actorId: string,
  reason: string,
  meta: RequestMeta,
): Promise<void> {
  await withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const invoice = await c.query<{ id: string; status: 'EMITIDA' | 'ANULADA'; sale_id: string }>(
      `SELECT id, status, sale_id FROM invoices WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [companyId, invoiceId],
    );
    const row = invoice.rows[0];
    if (!row) throw new AppError('INVOICE_NOT_FOUND', 'La factura no existe.', 404);
    if (row.status !== 'EMITIDA') throw new AppError('INVOICE_ALREADY_CANCELLED', 'La factura ya está anulada.', 409);

    await c.query(
      `UPDATE invoices SET status = 'ANULADA', canceled_at = now() WHERE company_id = $1 AND id = $2`,
      [companyId, invoiceId],
    );
    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'invoice.cancelled',
      ip: meta.ip,
      metadata: { invoiceId, saleId: row.sale_id, reason },
    });
  });
}
