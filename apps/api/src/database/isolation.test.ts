import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withContext } from './client.js';

// Estas pruebas necesitan una base real con las migraciones aplicadas.
// Si faltan las variables, se omiten (el CI sin base de datos sigue en verde).
const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL);

interface Tenant {
  companyId: string;
  userId: string;
  email: string;
  roleId: string;
  categoryId: string;
  productId: string;
  seriesId: string;
}

describe.skipIf(!enabled)('Aislamiento multiempresa (RLS)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  const createdCompanies: string[] = [];
  const createdUsers: string[] = [];
  let A: Tenant;
  let B: Tenant;

  async function seedTenant(label: string): Promise<Tenant> {
    const t: Tenant = {
      companyId: randomUUID(),
      userId: randomUUID(),
      email: `test-${label}-${randomUUID()}@example.test`,
      roleId: randomUUID(),
      categoryId: randomUUID(),
      productId: randomUUID(),
      seriesId: randomUUID(),
    };
    createdCompanies.push(t.companyId);
    createdUsers.push(t.userId);
    await admin.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [t.companyId, `test-${label}`]);
    await admin.query(`INSERT INTO roles (id, company_id, name) VALUES ($1, $2, 'Admin')`, [t.roleId, t.companyId]);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, 'hash-de-prueba', 'Usuario ${label}')`,
      [t.userId, t.email],
    );
    await admin.query(`INSERT INTO company_users (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      t.companyId, t.userId, t.roleId,
    ]);
    await admin.query(`INSERT INTO categories (id, company_id, name) VALUES ($1, $2, 'General')`, [t.categoryId, t.companyId]);
    await admin.query(
      `INSERT INTO products (id, company_id, category_id, sku, name, price) VALUES ($1, $2, $3, $4, 'Producto', 10)`,
      [t.productId, t.companyId, t.categoryId, `SKU-${label}`],
    );
    await admin.query(
      `INSERT INTO inventory_movements (company_id, product_id, type, quantity, stock_after, created_by)
       VALUES ($1, $2, 'ENTRADA', 5, 5, $3)`,
      [t.companyId, t.productId, t.userId],
    );
    await admin.query(`INSERT INTO invoice_series (id, company_id, code, prefix) VALUES ($1, $2, 'A', 'F-')`, [
      t.seriesId, t.companyId,
    ]);
    await admin.query(
      `INSERT INTO licenses (company_id, key_hash, duration_seconds) VALUES ($1, $2, 3600)`,
      [t.companyId, `hash-${randomUUID()}`],
    );
    return t;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    app = createPool(process.env.DATABASE_URL!);
    A = await seedTenant('a');
    B = await seedTenant('b');
  });

    afterAll(async () => {
    await admin.query(`DELETE FROM audit_logs WHERE action = 'test.isolation'`);
    await admin.query(`DELETE FROM inventory_movements WHERE company_id = ANY($1::uuid[])`, [createdCompanies]);
    await admin.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [createdCompanies]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
    await app.end();
    await admin.end();
  });

  it('el rol de la aplicación no ignora RLS', async () => {
    const r = await app.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('una empresa solo ve sus propios productos', async () => {
    const r = await withContext(app, { companyId: A.companyId }, (c) => c.query('SELECT id FROM products'));
    expect(r.rows.map((x) => x.id)).toEqual([A.productId]);
  });

  it('sin contexto de empresa no se ve ninguna fila', async () => {
    const r = await withContext(app, {}, (c) => c.query('SELECT count(*)::int AS n FROM products'));
    expect(r.rows[0].n).toBe(0);
  });

  it('no se puede leer por id un producto de otra empresa', async () => {
    const r = await withContext(app, { companyId: A.companyId }, (c) =>
      c.query('SELECT id FROM products WHERE id = $1', [B.productId]),
    );
    expect(r.rowCount).toBe(0);
  });

  it('no se puede insertar datos a nombre de otra empresa', async () => {
    await expect(
      withContext(app, { companyId: A.companyId }, (c) =>
        c.query(`INSERT INTO categories (company_id, name) VALUES ($1, 'Intruso')`, [B.companyId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('no se pueden modificar filas de otra empresa', async () => {
    const r = await withContext(app, { companyId: A.companyId }, (c) =>
      c.query(`UPDATE products SET name = 'hackeado' WHERE id = $1`, [B.productId]),
    );
    expect(r.rowCount).toBe(0);
  });

  it('las claves foráneas compuestas impiden mezclar empresas', async () => {
    await expect(
      withContext(app, { companyId: A.companyId }, (c) =>
        c.query(
          `INSERT INTO products (company_id, category_id, sku, name, price) VALUES ($1, $2, 'MIX', 'Mezcla', 1)`,
          [A.companyId, B.categoryId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('el historial de inventario es de solo inserción', async () => {
    await expect(
      withContext(app, { companyId: A.companyId }, (c) =>
        c.query(`UPDATE inventory_movements SET reason = 'manipulado'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withContext(app, { companyId: A.companyId }, (c) => c.query(`DELETE FROM inventory_movements`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('la auditoría es de solo inserción y respeta la empresa', async () => {
    await withContext(app, { companyId: A.companyId, userId: A.userId }, (c) =>
      c.query(`INSERT INTO audit_logs (company_id, user_id, action) VALUES ($1, $2, 'test.isolation')`, [
        A.companyId, A.userId,
      ]),
    );
    await expect(
      withContext(app, { companyId: A.companyId }, (c) => c.query(`UPDATE audit_logs SET action = 'x'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withContext(app, { companyId: A.companyId }, (c) =>
        c.query(`INSERT INTO audit_logs (company_id, action) VALUES ($1, 'test.isolation')`, [B.companyId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('una empresa no puede crear empresas; la plataforma sí', async () => {
    await expect(
      withContext(app, { companyId: A.companyId }, (c) => c.query(`INSERT INTO companies (name) VALUES ('Intrusa')`)),
    ).rejects.toThrow(/row-level security/);

    const id = randomUUID();
    createdCompanies.push(id);
    await withContext(app, { platform: true }, (c) =>
      c.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-plataforma')`, [id]),
    );
    const own = await withContext(app, { companyId: A.companyId }, (c) => c.query('SELECT id FROM companies'));
    expect(own.rows.map((x) => x.id)).toEqual([A.companyId]);
  });

  it('una empresa ve su licencia pero no puede activarla sin canjear la clave', async () => {
    const seen = await withContext(app, { companyId: A.companyId }, (c) => c.query('SELECT company_id FROM licenses'));
    expect(seen.rows.every((x) => x.company_id === A.companyId)).toBe(true);
    expect(seen.rowCount).toBe(1);

    await expect(
      withContext(app, { companyId: A.companyId }, (c) =>
        c.query(`UPDATE licenses SET status = 'ACTIVA', starts_at = now(), expires_at = now() + interval '1 year'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nadie desde la aplicación puede hacerse administrador de plataforma', async () => {
    await expect(
      withContext(app, { companyId: A.companyId, userId: A.userId }, (c) =>
        c.query(`UPDATE users SET is_platform_admin = true WHERE id = $1`, [A.userId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('un usuario solo ve a los miembros de su empresa', async () => {
    const r = await withContext(app, { companyId: A.companyId }, (c) => c.query('SELECT id FROM users'));
    expect(r.rows.map((x) => x.id)).toEqual([A.userId]);
  });

  it('la función de login encuentra usuarios sin contexto, ignorando mayúsculas', async () => {
    const r = await withContext(app, {}, (c) =>
      c.query('SELECT id FROM auth_get_user_by_email($1)', [A.email.toUpperCase()]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([A.userId]);
    const m = await withContext(app, {}, (c) => c.query('SELECT company_id FROM auth_list_memberships($1)', [A.userId]));
    expect(m.rows.map((x) => x.company_id)).toEqual([A.companyId]);
  });

  it('la numeración de facturas es correlativa y por empresa', async () => {
    const nums = await withContext(app, { companyId: A.companyId }, async (c) => {
      const one = await c.query('SELECT next_invoice_number($1) AS n', [A.seriesId]);
      const two = await c.query('SELECT next_invoice_number($1) AS n', [A.seriesId]);
      return [one.rows[0].n, two.rows[0].n];
    });
    expect(nums).toEqual(['1', '2']);

    await expect(
      withContext(app, { companyId: A.companyId }, (c) => c.query('SELECT next_invoice_number($1)', [B.seriesId])),
    ).rejects.toThrow(/Serie de facturación no encontrada/);
  });

  it('una transacción fallida no consume números de factura', async () => {
    await expect(
      withContext(app, { companyId: B.companyId }, async (c) => {
        await c.query('SELECT next_invoice_number($1)', [B.seriesId]);
        throw new Error('fallo simulado');
      }),
    ).rejects.toThrow(/fallo simulado/);
    const n = await withContext(app, { companyId: B.companyId }, (c) =>
      c.query('SELECT next_invoice_number($1) AS n', [B.seriesId]),
    );
    expect(n.rows[0].n).toBe('1');
  });
});
