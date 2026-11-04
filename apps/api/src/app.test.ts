import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv({ NODE_ENV: 'test' });

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

  it('rechaza una configuración inválida al arrancar', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Configuración inválida/);
  });
});
