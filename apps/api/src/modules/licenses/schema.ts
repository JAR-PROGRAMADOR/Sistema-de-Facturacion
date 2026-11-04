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

export const redeemLicenseSchema = z.object({
  key: z.string().min(16).max(512),
});

export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type CreateUserLicenseInput = z.infer<typeof createUserLicenseSchema>;
