import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Env } from '../../config/env.js';
import type { AuthContext } from './service.js';
import * as service from './service.js';
import { createCompany } from '../companies/service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  twoFactorConfirmSchema,
  twoFactorDisableSchema,
} from './schema.js';

const REFRESH_COOKIE = 'refresh_token';

function cookieOptions(env: Env, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
    maxAge: maxAgeSeconds,
  };
}

function requestMeta(req: { ip: string; headers: Record<string, unknown> }) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null };
}

function sendTokens(reply: FastifyReply, env: Env, tokens: Awaited<ReturnType<typeof service.login>>): void {
  const maxAge = Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000);
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(env, maxAge));
  reply.send({
    data: {
      accessToken: tokens.accessToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: tokens.session.userId,
        fullName: tokens.session.fullName,
        locale: tokens.session.locale,
        companyId: tokens.session.companyId,
        platform: tokens.session.platform,
        memberships: tokens.session.memberships,
      },
    },
  });
}

export async function authRoutes(app: FastifyInstance, opts: { env: Env; auth: AuthContext }): Promise<void> {
  const { env, auth } = opts;

  app.post('/auth/login', async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const tokens = await service.login(auth, input, requestMeta(req));
    sendTokens(reply, env, tokens);
  });

  app.post('/auth/register', async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const company = await createCompany(
      auth,
      {
        name: input.name,
        currency: input.currency,
        locale: input.locale,
        timezone: input.timezone,
        adminEmail: input.email,
        adminFullName: input.fullName,
      },
      requestMeta(req),
      input.password,
    );
    reply.status(201).send({
      data: {
        company: { id: company.id, name: company.name },
        message: 'Cuenta creada. Para empezar a usar el sistema, solicita y activa las licencias de empresa y usuario.',
      },
    });
  });

  app.post('/auth/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) {
      return reply.status(401).send({
        error: { code: 'INVALID_SESSION', message: 'Tu sesión no es válida. Inicia sesión nuevamente.' },
      });
    }
    const tokens = await service.refresh(auth, token, requestMeta(req));
    sendTokens(reply, env, tokens);
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await service.logout(auth, token);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send({
      data: { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat },
    });
  });

  app.post('/auth/change-password', { preHandler: app.authenticate }, async (req, reply) => {
    const input = changePasswordSchema.parse(req.body);
    await service.changePassword(
      auth,
      { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat },
      input,
      req.user.fam,
    );
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    reply.status(204).send();
  });

  // ---------------------------------------------------------------- FASE 3b: recuperación

  app.post('/auth/forgot-password', async (req, reply) => {
    const input = forgotPasswordSchema.parse(req.body);
    await service.requestPasswordReset(auth, input.email);
    // Respuesta genérica siempre, exista o no el correo: no revela qué cuentas existen.
    reply.status(202).send({
      data: { message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' },
    });
  });

  app.post('/auth/reset-password', async (req, reply) => {
    const input = resetPasswordSchema.parse(req.body);
    await service.resetPassword(auth, input.token, input.newPassword);
    reply.status(204).send();
  });

  // ---------------------------------------------------------------- FASE 3b: 2FA

  app.post('/auth/2fa/setup', { preHandler: app.authenticate }, async (req, reply) => {
    const authUser = { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat };
    // El correo del usuario se necesita para el texto del código QR (otpauth://).
    const email = await service.getAccountEmail(auth, authUser);
    const result = await service.setupTwoFactor(auth, authUser, email);
    reply.send({ data: result });
  });

  app.post('/auth/2fa/confirm', { preHandler: app.authenticate }, async (req, reply) => {
    const input = twoFactorConfirmSchema.parse(req.body);
    await service.confirmTwoFactor(
      auth,
      { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat },
      input.code,
    );
    reply.status(204).send();
  });

  app.post('/auth/2fa/disable', { preHandler: app.authenticate }, async (req, reply) => {
    const input = twoFactorDisableSchema.parse(req.body);
    await service.disableTwoFactor(
      auth,
      { userId: req.user.sub, companyId: req.user.cid, platform: req.user.plat },
      input.password,
    );
    reply.status(204).send();
  });
}
