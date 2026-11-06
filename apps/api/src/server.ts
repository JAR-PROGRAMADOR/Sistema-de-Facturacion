import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './database/client.js';

const env = loadEnv();
console.log('[env-check] DATABASE_URL present:', Boolean(env.DATABASE_URL));
console.log('[env-check] JWT_ACCESS_SECRET present:', Boolean(env.JWT_ACCESS_SECRET), 'len:', env.JWT_ACCESS_SECRET?.length ?? 0);
console.log('[env-check] APP_DB_PASSWORD present:', Boolean(env.APP_DB_PASSWORD));
console.log('[env-check] vars con JWT/DATABASE:', Object.keys(process.env).filter((k) => /JWT|DATABASE/.test(k)));

const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
if (!pool) {
  console.warn('DATABASE_URL no está definida: la API arranca solo con /health, sin rutas de autenticación.');
}

const app = await buildApp({ env, pool });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
