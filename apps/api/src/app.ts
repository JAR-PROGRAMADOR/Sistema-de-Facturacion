import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import type { Env } from './config/env.js';
import { registerErrorHandling } from './shared/errors.js';
import { registerAuth, type AccessClaims } from './plugins/authenticate.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { companiesRoutes } from './modules/companies/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { rolesRoutes } from './modules/roles/routes.js';
import { licensesRoutes } from './modules/licenses/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { categoriesRoutes } from './modules/categories/routes.js';
import { suppliersRoutes } from './modules/suppliers/routes.js';
import { productsRoutes } from './modules/products/routes.js';
import { customersRoutes } from './modules/customers/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { salesRoutes } from './modules/sales/routes.js';
import { purchasesRoutes } from './modules/purchases/routes.js';
import { invoicesRoutes } from './modules/invoices/routes.js';
import { reportsRoutes } from './modules/reports/routes.js';
import { cashRoutes } from './modules/cash/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import type { AuthContext } from './modules/auth/service.js';

export interface BuildAppOptions {
  env: Env;
  /** Pool de la aplicación (rol app_user). Opcional: health y typecheck funcionan sin base. */
  pool?: Pool;
}

export async function buildApp({ env, pool }: BuildAppOptions) {
  const app = Fastify({
    trustProxy: true,
    logger:
      env.NODE_ENV === 'test'
        ? false
        : { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  registerErrorHandling(app);

  await app.register(healthRoutes, { prefix: '/api/v1' });

  if (pool) {
    await registerAuth(app, env, pool);

    const auth: AuthContext = {
      pool,
      env,
      signAccessToken: (claims: Omit<AccessClaims, 'iat' | 'exp'>) =>
        app.jwt.sign(claims, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS }),
    };

    const loginRateLimit = env.NODE_ENV === 'test' ? 100_000 : env.LOGIN_RATE_LIMIT_MAX;
    await app.register(
      async (scoped) => {
        await scoped.register(rateLimit, { max: loginRateLimit, timeWindow: '1 minute' });
        await authRoutes(scoped, { env, auth });
      },
      { prefix: '/api/v1' },
    );

    // companiesRoutes espera { env, auth } (usa ctx.pool/ctx.env a través de auth), igual
    // que authRoutes. NO se le pasa `pool` suelto: ese era el error.
    await app.register(companiesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(usersRoutes, { prefix: '/api/v1', env, auth });
    await app.register(rolesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(licensesRoutes, { prefix: '/api/v1', pool });
    await app.register(settingsRoutes, { prefix: '/api/v1', env, auth });
    await app.register(categoriesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(suppliersRoutes, { prefix: '/api/v1', env, auth });
    await app.register(productsRoutes, { prefix: '/api/v1', env, auth });
    await app.register(customersRoutes, { prefix: '/api/v1', env, auth });
    await app.register(inventoryRoutes, { prefix: '/api/v1', env, auth });
    await app.register(salesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(purchasesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(invoicesRoutes, { prefix: '/api/v1', env, auth });
    await app.register(reportsRoutes, { prefix: '/api/v1', env, auth });
    await app.register(cashRoutes, { prefix: '/api/v1', env, auth });
    await app.register(auditRoutes, { prefix: '/api/v1', env, auth });
  }

  return app;
}
