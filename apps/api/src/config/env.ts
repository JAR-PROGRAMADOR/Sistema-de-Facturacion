import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('https://sistema-de-facturacion-op8d.onrender.com/'),

  // Conexión de la aplicación (rol app_user, sujeto a RLS).
  DATABASE_URL: z.string().optional(),
  // Conexión del dueño del esquema: SOLO migraciones, pruebas y scripts. Nunca la usa la API.
  DATABASE_ADMIN_URL: z.string().optional(),
  // Contraseña que el script de migraciones asigna al rol app_user.
  APP_DB_PASSWORD: z.string().min(16).optional(),

  // Autenticación (FASE 3a)
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_MAX_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Primer superadministrador de plataforma (arranque). Opcionales, pero van
  // siempre juntas: con ellas el servidor asegura al arrancar que exista un
  // superadministrador que pueda emitir claves de licencia. Sin ellas no se
  // crea ni se promueve a nadie. La contraseña sigue la misma regla que las
  // de los usuarios web: mínimo 12 caracteres.
  PLATFORM_ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(12).optional(),

  // Recuperación de contraseña y 2FA (FASE 3b)
  FRONTEND_URL: z.string().default('https://sistema-de-facturacion-op8d.onrender.com/'),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  TWO_FACTOR_ISSUER: z.string().default('Facturacion'),
}).refine(
  (env) => Boolean(env.PLATFORM_ADMIN_EMAIL) === Boolean(env.PLATFORM_ADMIN_PASSWORD),
  {
    message: 'PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD van siempre juntas: define las dos o ninguna.',
    path: ['PLATFORM_ADMIN_EMAIL'],
  },
);

export type Env = z.infer<typeof envSchema>;

/** Valida las variables de entorno al arrancar. Falla rápido si algo es inválido. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${problems}`);
  }
  return parsed.data;
}
