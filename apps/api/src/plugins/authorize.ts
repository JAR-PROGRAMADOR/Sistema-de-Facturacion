import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withContext } from '../database/client.js';
import { AppError } from '../shared/errors.js';
import { hasFullyActiveLicense } from '../modules/licenses/service.js';

/** Solo el superadministrador de plataforma puede continuar. */
export function requirePlatform() {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user.plat) {
      throw new AppError(
        'FORBIDDEN',
        'Esta acción solo está disponible para el superadministrador de la plataforma.',
        403,
      );
    }
  };
}

/**
 * Exige un permiso concreto dentro de la empresa activa del usuario. El superadministrador
 * de plataforma siempre pasa (no participa del sistema de permisos por empresa).
 *
 * También aplica aquí, para TODA ruta de negocio que pase por un permiso, la licencia
 * vencida = bloqueo total (decisión aprobada en la FASE 0): si la empresa o el usuario no
 * tienen una licencia activa y vigente, la petición se rechaza con 402 ANTES de llegar a
 * revisar el permiso puntual. Las dos únicas rutas que no pasan por aquí son
 * `/license-status` y `/licenses/redeem` (para poder resolver el problema sin quedar
 * atrapado fuera del sistema).
 */
export function requirePermission(pool: Pool, code: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (req.user.plat) return;
    if (!req.user.cid) {
      throw new AppError('FORBIDDEN', 'Tu sesión no tiene una empresa activa.', 403);
    }

    const { allowed, licensed } = await withContext(
      pool,
      { userId: req.user.sub, companyId: req.user.cid },
      async (c) => {
        const licensed = await hasFullyActiveLicense(c, req.user.cid!, req.user.sub);
        if (!licensed) return { allowed: false, licensed: false };
        const r = await c.query(
          `SELECT 1
             FROM company_users cu
             JOIN role_permissions rp ON rp.role_id = cu.role_id AND rp.company_id = cu.company_id
            WHERE cu.company_id = $1 AND cu.user_id = $2 AND cu.status = 'ACTIVO' AND rp.permission_code = $3`,
          [req.user.cid, req.user.sub, code],
        );
        return { allowed: (r.rowCount ?? 0) > 0, licensed: true };
      },
    );

    if (!licensed) {
      throw new AppError(
        'LICENSE_EXPIRED',
        'La licencia de tu empresa o de tu usuario no está activa. Consulta /license-status para resolverlo.',
        402,
      );
    }
    if (!allowed) {
      throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.', 403);
    }
  };
}
