import type { Pool } from 'pg';

import { hashPassword } from './password.js';

/**
 * Asegura que exista el primer superadministrador de plataforma.
 *
 * Sin superadministrador no hay nadie que emita claves de licencia y ninguna
 * empresa puede entrar: la app queda bloqueada en la pantalla de activación.
 * El rol app_user no puede escribir `users.is_platform_admin` directamente, así
 * que esto pasa por la función SECURITY DEFINER `ensure_platform_admin`
 * (migración 0014), propiedad del dueño del esquema.
 *
 * Solo se llama al arrancar el servidor y solo si están definidas
 * PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD. Si el usuario ya existe, se
 * le da el rol y se conserva su contraseña actual; si no existe, se crea con la
 * contraseña indicada. Nunca se registra la contraseña en los logs.
 */
export async function ensurePlatformAdmin(
  pool: Pool,
  email: string,
  password: string,
): Promise<{ userId: string; created: boolean }> {
  const passwordHash = await hashPassword(password);
  const result = await pool.query<{ user_id: string; created: boolean }>(
    'SELECT * FROM ensure_platform_admin($1, $2)',
    [email.trim().toLowerCase(), passwordHash],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ensure_platform_admin no devolvió ningún resultado.');
  }
  return { userId: row.user_id, created: row.created };
}
