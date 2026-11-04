import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Env } from '../config/env.js';
import { AppError } from '../shared/errors.js';
import { assertLicenseAccess } from './licenseAccess.js';
import { assertPermissionAccess } from './permissionAccess.js';

/** Contenido del token de acceso (corto). cid = empresa activa; null en sesión de plataforma. */
export interface AccessClaims {
  sub: string;
  cid: string | null;
  plat: boolean;
  fam: string;
  iat?: number;
  exp?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    requirePlatform: (req: FastifyRequest) => Promise<void>;
  }
}

/** Registra cookies, JWT (solo HS256) y el hook `app.authenticate` para proteger rutas. */
export async function registerAuth(app: FastifyInstance, env: Env, pool?: Pool): Promise<void> {
  if (!env.JWT_ACCESS_SECRET) {
    throw new Error('Falta JWT_ACCESS_SECRET (mínimo 32 caracteres) en el archivo .env');
  }

  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.', 401);
    }
    if (pool && req.user) {
      await assertLicenseAccess(pool, req.user, { method: req.method, url: req.url });
      await assertPermissionAccess(pool, req.user, { method: req.method, url: req.url });
    }
  });

  app.decorate('requirePlatform', async (req: FastifyRequest) => {
    if (!req.user?.plat) {
      throw new AppError('FORBIDDEN', 'No tienes permisos para acceder a este recurso.', 403);
    }
  });
}
