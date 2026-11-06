import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(128, 'La contraseña no puede superar los 128 caracteres.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  companyId: z.string().uuid().optional(),
  // Código TOTP (6 dígitos) o código de recuperación (formato XXXX-XXXX), solo cuando el
  // usuario tiene 2FA habilitado.
  twoFactorCode: z.string().min(6).max(20).optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  licenseKey: z.string().trim().min(16).max(512).optional(),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  locale: z.enum(['es', 'en', 'tr', 'zh-CN', 'ja', 'ko']).default('es'),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  newPassword: passwordSchema,
});

export const twoFactorConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
});

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
