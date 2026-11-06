import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Carga el .env de la raíz del monorepo para las pruebas de base de datos.
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    env: loadEnv('test', root, ''),
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    minWorkers: 2,
    maxWorkers: 2,
  },
});
