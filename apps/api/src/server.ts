import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './database/client.js';
import { ensurePlatformAdmin } from './modules/auth/bootstrap.js';

const env = loadEnv();
console.log('[env-check] DATABASE_URL present:', Boolean(env.DATABASE_URL));
console.log('[env-check] JWT_ACCESS_SECRET present:', Boolean(env.JWT_ACCESS_SECRET), 'len:', env.JWT_ACCESS_SECRET?.length ?? 0);
console.log('[env-check] APP_DB_PASSWORD present:', Boolean(env.APP_DB_PASSWORD));
console.log('[env-check] vars con JWT/DATABASE:', Object.keys(process.env).filter((k) => /JWT|DATABASE/.test(k)));

const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
if (!pool) {
  console.warn('DATABASE_URL no está definida: la API arranca solo con /health, sin rutas de autenticación.');
}

// Primer superadministrador de plataforma (ver bootstrap.ts): sin él nadie puede
// emitir claves de licencia y las empresas quedan bloqueadas en la pantalla de
// activación. No es un error fatal si falla (por ejemplo, si la migración 0014
// aún no se aplicó): la API arranca igual y el arranque lo deja en el log.
if (pool && env.PLATFORM_ADMIN_EMAIL && env.PLATFORM_ADMIN_PASSWORD) {
  try {
    const result = await ensurePlatformAdmin(pool, env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD);
    console.log(`[bootstrap] Superadministrador de plataforma asegurado (${result.created ? 'creado' : 'ya existía'}).`);
  } catch (err) {
    console.error(
      '[bootstrap] No se pudo asegurar el superadministrador de plataforma. Aplica la migración 0014 y revisa PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD.',
      err,
    );
  }
}

const app = await buildApp({ env, pool });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
