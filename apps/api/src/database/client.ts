import pg from 'pg';
import { z } from 'zod';

const uuid = z.string().uuid();

export interface RequestContext {
  /** Empresa activa. Debe salir del token verificado, nunca de parámetros del cliente. */
  companyId?: string | undefined;
  userId?: string | undefined;
  /** Solo rutas /platform/* autorizadas para el superadministrador. */
  platform?: boolean | undefined;
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Fija el contexto de la transacción en curso (se descarta al terminar la transacción). */
export async function applyContext(client: pg.PoolClient, ctx: RequestContext): Promise<void> {
  await client.query(
    `SELECT set_config('app.company_id', $1, true),
            set_config('app.user_id', $2, true),
            set_config('app.is_platform', $3, true)`,
    [
      ctx.companyId ? uuid.parse(ctx.companyId) : '',
      ctx.userId ? uuid.parse(ctx.userId) : '',
      ctx.platform ? 'true' : 'false',
    ],
  );
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de empresa fijado.
 * Las políticas RLS de PostgreSQL leen ese contexto, así que aunque una consulta olvide
 * filtrar por company_id, la base solo devuelve filas de la empresa activa.
 */
export async function withContext<T>(
  pool: pg.Pool,
  ctx: RequestContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
