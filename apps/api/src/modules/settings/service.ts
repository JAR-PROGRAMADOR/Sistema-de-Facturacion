import { withContext } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import { insertAudit } from '../auth/repository.js';
import type { AuthContext } from '../auth/service.js';
import type { UpdateSettingsInput } from './schema.js';

export interface CompanySettings {
  requireCustomerOnSale: boolean;
  requirePaymentReference: boolean;
  receiptFooter: string | null;
}

function normalize(data: Record<string, unknown> | null | undefined): CompanySettings {
  return {
    requireCustomerOnSale: data?.requireCustomerOnSale === true,
    requirePaymentReference: data?.requirePaymentReference === true,
    receiptFooter: typeof data?.receiptFooter === 'string' ? data.receiptFooter : null,
  };
}

export async function getCompanySettings(ctx: AuthContext, companyId: string): Promise<CompanySettings> {
  return withContext(ctx.pool, { companyId, platform: true }, async (c) => {
    const result = await c.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM company_settings WHERE company_id = $1`,
      [companyId],
    );
    return normalize(result.rows[0]?.data);
  });
}

export async function updateCompanySettings(
  ctx: AuthContext,
  companyId: string,
  input: UpdateSettingsInput,
  actorId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<CompanySettings> {
  return withContext(ctx.pool, { companyId, userId: actorId, platform: true }, async (c) => {
    const result = await c.query<{ data: Record<string, unknown> }>(
      `INSERT INTO company_settings (company_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (company_id) DO UPDATE SET data = company_settings.data || EXCLUDED.data
       RETURNING data`,
      [companyId, JSON.stringify(input)],
    );
    if (!result.rows[0]) throw new AppError('SETTINGS_NOT_SAVED', 'No fue posible guardar la configuración.', 500);
    await insertAudit(c, {
      companyId,
      userId: actorId,
      action: 'settings.updated',
      ip: meta.ip,
      metadata: { fields: Object.keys(input) },
    });
    return normalize(result.rows[0].data);
  });
}
