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

const a = await companiesService.createCompany(ctx, { name: 'A2', currency: 'USD', locale: 'es', timezone: 'UTC' }, { ip: null, userAgent: null });
const b = await companiesService.createCompany(ctx, { name: 'B2', currency: 'USD', locale: 'es', timezone: 'UTC' }, { ip: null, userAgent: null });
const rA = await rolesService.listRoles(ctx, a.id);
const rB = await rolesService.listRoles(ctx, b.id);
const vA = rA.find((r) => r.name === 'Vendedor')!.id;
const aAdmin = rA.find((r) => r.name === 'Administrador')!.id;
const vB = rB.find((r) => r.name === 'Vendedor')!.id;

const user = await usersService.createUser(ctx, b.id, { email: `u-${randomUUID()}@test.local`, fullName: 'U', password: 'Test1!Secure#2024$XyZ', roleIds: [vB] }, { ip: null, userAgent: null });
console.log('before cross company update');
try {
  const result = await usersService.updateUser(ctx, b.id, user.id, { roleIds: [vA] }, { ip: null, userAgent: null });
  console.log('cross company accepted', result.roles.map((r) => r.name));
} catch (err) {
  console.log('cross company rejected', err);
}

const c = await companiesService.createCompany(ctx, { name: 'C2', currency: 'USD', locale: 'es', timezone: 'UTC' }, { ip: null, userAgent: null });
const rolesC = await rolesService.listRoles(ctx, c.id);
const ar = rolesC.find((r) => r.name === 'Administrador')!.id;
const vr = rolesC.find((r) => r.name === 'Vendedor')!.id;
await usersService.createUser(ctx, c.id, { email: `u-${randomUUID()}@test.local`, fullName: 'U1', password: 'Test1!Secure#2024$XyZ', roleIds: [ar] }, { ip: null, userAgent: null });
const u2 = await usersService.createUser(ctx, c.id, { email: `u-${randomUUID()}@test.local`, fullName: 'U2', password: 'Test1!Secure#2024$XyZ', roleIds: [vr] }, { ip: null, userAgent: null });
try {
  const updated = await usersService.updateUser(ctx, c.id, u2.id, { roleIds: [ar] }, { ip: null, userAgent: null });
  console.log('replace roles result', updated.roles.map((r) => r.name));
} catch (err) {
  console.log('replace roles rejected', err);
}

await pool.end();
