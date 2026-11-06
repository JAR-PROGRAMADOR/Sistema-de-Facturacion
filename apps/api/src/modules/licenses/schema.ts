import { z } from 'zod';

// Duración en segundos: desde 1 minuto hasta, en la práctica, varios años.
const durationSeconds = z.coerce.number().int().min(60).max(10 * 365 * 86_400);

export const createLicenseSchema = z.object({
  companyId: z.string().uuid(),
  durationSeconds,
  maxUsers: z.coerce.number().int().min(1).max(100_000).default(5),
});

export const createUserLicenseSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  durationSeconds,
});

export const createRegistrationLicenseSchema = z.object({
  durationSeconds,
  maxUsers: z.coerce.number().int().min(1).max(100_000).default(5),
});

export const redeemLicenseSchema = z.object({
  // Código de activación de 6 dígitos. Se aceptan también las claves largas
  // emitidas antes del cambio, para no dejar sin canje las que ya están
  // pendientes; la interfaz solo pide y muestra códigos de 6 dígitos.
  key: z.string().min(6).max(512),
});

export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type CreateUserLicenseInput = z.infer<typeof createUserLicenseSchema>;
export type CreateRegistrationLicenseInput = z.infer<typeof createRegistrationLicenseSchema>;
