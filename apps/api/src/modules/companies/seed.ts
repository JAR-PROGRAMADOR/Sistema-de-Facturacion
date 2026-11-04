import type { PoolClient } from 'pg';

/**
 * Siembra los datos mínimos que toda empresa necesita para operar.
 * Se ejecuta con el contexto de la nueva empresa ya fijado (applyContext).
 */
export async function seedCompanyDefaults(c: PoolClient, companyId: string): Promise<{ adminRoleId: string; vendorRoleId: string }> {
  // 1) company_settings vacío
  await c.query(
    `INSERT INTO company_settings (company_id, data) VALUES ($1, '{}'::jsonb)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId],
  );

  // 2) tax_rate 0% por defecto (neutro; el admin lo ajusta)
  await c.query(
    `INSERT INTO tax_rates (company_id, name, rate, is_default)
     VALUES ($1, 'Exento', 0, true)`,
    [companyId],
  );

  // 3) serie de facturación por defecto
  await c.query(
    `INSERT INTO invoice_series (company_id, code, prefix, is_default)
     VALUES ($1, 'FAC', '', true)`,
    [companyId],
  );

  // 4) métodos de pago básicos
  await c.query(
    `INSERT INTO payment_methods (company_id, code, name)
     VALUES ($1,'EFECTIVO','Efectivo'), ($1,'TARJETA','Tarjeta'), ($1,'TRANSFERENCIA','Transferencia')`,
    [companyId],
  );

  // 5) rol Administrador con TODOS los permisos
  const admin = await c.query<{ id: string }>(
    `INSERT INTO roles (company_id, name, description, is_system)
     VALUES ($1, 'Administrador', 'Acceso completo a la empresa', true)
     RETURNING id`,
    [companyId],
  );
  const adminId = admin.rows[0]!.id;
  await c.query(
    `INSERT INTO role_permissions (company_id, role_id, permission_code)
     SELECT $1, $2, code FROM permissions`,
    [companyId, adminId],
  );

  // 6) rol Vendedor con permisos operativos
  const seller = await c.query<{ id: string }>(
    `INSERT INTO roles (company_id, name, description, is_system)
     VALUES ($1, 'Vendedor', 'Operación de POS, ventas y clientes', true)
     RETURNING id`,
    [companyId],
  );
  const sellerId = seller.rows[0]!.id;
  await c.query(
    `INSERT INTO role_permissions (company_id, role_id, permission_code) VALUES
       ($1,$2,'pos.use'),
       ($1,$2,'sales.view'),($1,$2,'sales.create'),
       ($1,$2,'customers.view'),($1,$2,'customers.create'),($1,$2,'customers.edit'),
       ($1,$2,'products.view'),
       ($1,$2,'inventory.view'),
       ($1,$2,'cash.view'),($1,$2,'cash.open'),($1,$2,'cash.close'),
       ($1,$2,'payments.view'),($1,$2,'payments.create'),
       ($1,$2,'invoices.view'),($1,$2,'invoices.create')`,
    [companyId, sellerId],
  );

  return { adminRoleId: adminId, vendorRoleId: sellerId };
}