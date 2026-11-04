import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv({ NODE_ENV: 'test' });
const hasWebBuild = existsSync(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)));

describe('API base', () => {
  it('responde el health check con el formato estándar', async () => {
    const app = await buildApp({ env });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ok');
    await app.close();
  });

  it('devuelve errores 404 con el formato estándar y sin detalles técnicos', async () => {
    const app = await buildApp({ env });
    const res = await app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it.skipIf(!hasWebBuild)('sirve la aplicación web en la raíz y en rutas del cliente', async () => {
    const app = await buildApp({ env });
    const home = await app.inject({ method: 'GET', url: '/' });
    const login = await app.inject({ method: 'GET', url: '/login' });

    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.body).toContain('<div id="root"></div>');
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('<div id="root"></div>');
    await app.close();
  });

  it('rechaza una configuración inválida al arrancar', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Configuración inválida/);
  });
});
