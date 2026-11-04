import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.APP_DB_PASSWORD;

if (!adminUrl || !appPassword || appPassword.length < 16) {
  console.error('Define DATABASE_ADMIN_URL y APP_DB_PASSWORD (mínimo 16 caracteres) en el archivo .env');
  process.exit(1);
}

const migrationsDir = new URL('../../migrations/', import.meta.url);
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();

try {
  // 1. Rol de la aplicación: sin BYPASSRLS ni superusuario, para que las políticas RLS le apliquen.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$`);
  const pwd = await client.query<{ q: string }>(
    `SELECT format('ALTER ROLE app_user PASSWORD %L', $1::text) AS q`,
    [appPassword],
  );
  await client.query(pwd.rows[0]!.q);

  // 2. Control de migraciones.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied = new Set(
    (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  // 3. Cada archivo .sql pendiente se aplica en su propia transacción.
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, migrationsDir), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Aplicada: ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Falló ${file}; se revirtió.`);
      throw err;
    }
  }
  console.log(count === 0 ? 'La base de datos ya está al día.' : `Listo: ${count} migración(es) aplicada(s).`);
} finally {
  await client.end();
}
