import type { Pool } from 'pg';
import { withContext } from '../database/client.js';
import { AppError } from '../shared/errors.js';
import type { AccessClaims } from './authenticate.js';

function requiredPermission(path: string, method: string): string | null {
  if (path.startsWith('/api/v1/platform/')) return null;
  const route = path.replace(/^\/api\/v1/, '');

  if (route === '/roles' || /^\/roles\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'roles.view';
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return 'roles.manage';
  }
  if (/^\/roles\/[^/]+\/permissions$/.test(route)) return 'roles.manage';

  if (route === '/users' || /^\/users\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'users.view';
    if (method === 'POST') return 'users.create';
    if (method === 'PATCH') return 'users.edit';
    if (method === 'DELETE') return 'users.delete';
  }

  if (route === '/categories' || /^\/categories\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'categories.view';
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return 'categories.manage';
  }

  if (route === '/products' || /^\/products\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'products.view';
    if (method === 'POST') return 'products.create';
    if (method === 'PATCH') return 'products.edit';
    if (method === 'DELETE') return 'products.delete';
  }

  if (route === '/inventory' || /^\/inventory\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'inventory.view';
  }
  if (route === '/inventory/adjust' && method === 'POST') return 'inventory.adjust';

  if (route === '/customers' || /^\/customers\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'customers.view';
    if (method === 'POST') return 'customers.create';
    if (method === 'PATCH') return 'customers.edit';
    if (method === 'DELETE') return 'customers.delete';
  }

  if (route === '/suppliers' || /^\/suppliers\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'suppliers.view';
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return 'suppliers.manage';
  }

  if (route === '/cash-sessions/open' && method === 'GET') return 'cash.view';
  if (route === '/cash-sessions' && method === 'POST') return 'cash.open';
  if (/^\/cash-sessions\/[^/]+\/movements$/.test(route) && method === 'POST') return 'cash.close';
  if (/^\/cash-sessions\/[^/]+\/close$/.test(route) && method === 'POST') return 'cash.close';

  if (route === '/payment-methods' && method === 'GET') return 'payments.view';
  if (route === '/payment-methods' && method === 'POST') return 'settings.edit';
  if (/^\/payment-methods\/[^/]+$/.test(route) && method === 'PATCH') return 'settings.edit';
  if (route === '/tax-rates' && method === 'GET') return 'settings.view';
  if (route === '/tax-rates' && method === 'POST') return 'settings.edit';
  if (/^\/tax-rates\/[^/]+$/.test(route) && method === 'PATCH') return 'settings.edit';
  if (route === '/sales' && method === 'GET') return 'sales.view';
  if (route === '/sales' && method === 'POST') return 'sales.create';
  if (/^\/sales\/[^/]+\/cancel$/.test(route) && method === 'POST') return 'sales.cancel';
  if (/^\/sales\/[^/]+\/invoice$/.test(route) && method === 'POST') return 'invoices.create';
  if (route === '/invoices' && method === 'GET') return 'invoices.view';
  if (/^\/invoices\/[^/]+$/.test(route) && method === 'GET') return 'invoices.view';
  if (/^\/invoices\/[^/]+\/cancel$/.test(route) && method === 'POST') return 'invoices.cancel';
  if (route.startsWith('/reports/')) return 'reports.view';
  if (route === '/audit-logs' && method === 'GET') return 'audit.view';
  if (route === '/settings' && method === 'GET') return 'settings.view';
  if (route === '/settings' && method === 'PATCH') return 'settings.edit';
  if (route === '/purchases' && method === 'GET') return 'purchases.view';
  if (route === '/purchases' && method === 'POST') return 'purchases.create';
  if (/^\/purchases\/[^/]+\/cancel$/.test(route) && method === 'POST') return 'purchases.cancel';

  return null;
}

export async function assertPermissionAccess(
  pool: Pool,
  claims: AccessClaims,
  request: { method: string; url: string },
): Promise<void> {
  if (claims.plat || !claims.cid) return;

  const path = request.url.split('?')[0]!;
  if (path.startsWith('/api/v1/platform/')) return;

  const permissionCode = requiredPermission(path, request.method);
  if (!permissionCode) return;

  const result = await withContext(pool, { companyId: claims.cid, userId: claims.sub }, async (c) =>
    c.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM company_users cu
           JOIN role_permissions rp ON rp.company_id = cu.company_id AND rp.role_id = cu.role_id
          WHERE cu.company_id = $1 AND cu.user_id = $2 AND cu.status = 'ACTIVO'
            AND rp.permission_code = $3
       ) AS allowed`,
      [claims.cid, claims.sub, permissionCode],
    ),
  );

  if (!result.rows[0]?.allowed) {
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.', 403, {
      permission: permissionCode,
    });
  }
}
