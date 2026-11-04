import { randomUUID } from 'node:crypto';
import { createPool } from './src/database/client.ts';
import * as companiesService from './src/modules/companies/service.ts';
import * as rolesService from './src/modules/roles/service.ts';
import * as usersService from './src/modules/users/service.ts';

const env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  ACCESS_TOKEN_TTL_SECONDS: 600,
  REFRESH_TOKEN_TTL_DAYS: 7,
  SESSION_MAX_DAYS: 30,
  LOGIN_RATE_LIMIT_MAX: 10,
  FRONTEND_URL: 'http://localhost:5173',
  PASSWORD_RESET_TTL_MINUTES: 60,
  TWO_FACTOR_ISSUER: 'Test',
};
const pool = createPool(process.env.DATABASE_URL!);
const ctx = { pool, env, signAccessToken: () => 'test-token' };
const a = await companiesService.createCompany(ctx, { name: 'A', currency: 'USD', locale: 'es', timezone: 'UTC' }, { ip: null, userAgent: null });
const b = await companiesService.createCompany(ctx, { name: 'B', currency: 'USD', locale: 'es', timezone: 'UTC' }, { ip: null, userAgent: null });
const rolesA = await rolesService.listRoles(ctx, a.id);
const rolesB = await rolesService.listRoles(ctx, b.id);
const vA = rolesA.find((r) => r.name === 'Vendedor')?.id;
const vB = rolesB.find((r) => r.name === 'Vendedor')?.id;
console.log('companyA', a.id, 'companyB', b.id, 'vA', vA, 'vB', vB);
const ua = await usersService.createUser(ctx, a.id, { email: `u-${randomUUID()}@test.local`, fullName: 'A1', password: 'Test1!Secure#2024$XyZ', roleIds: [vA!] }, { ip: null, userAgent: null });
const ub = await usersService.createUser(ctx, b.id, { email: `u-${randomUUID()}@test.local`, fullName: 'B1', password: 'Test1!Secure#2024$XyZ', roleIds: [vB!] }, { ip: null, userAgent: null });
console.log('created', ua.id, ub.id);
const la = await usersService.listUsers(ctx, a.id, { page: 1, limit: 100 });
const lb = await usersService.listUsers(ctx, b.id, { page: 1, limit: 100 });
console.log('A list IDs', la.items.map((u) => ({ id: u.id, roles: u.roles.map((r) => r.name) })));
console.log('B list IDs', lb.items.map((u) => ({ id: u.id, roles: u.roles.map((r) => r.name) })));
await pool.end();
