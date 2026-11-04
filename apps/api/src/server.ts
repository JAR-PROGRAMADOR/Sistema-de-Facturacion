import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './database/client.js';

const env = loadEnv();
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
