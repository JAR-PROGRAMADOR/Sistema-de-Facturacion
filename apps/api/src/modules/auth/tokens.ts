import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de 256 bits. Solo su hash se guarda en la base de datos. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
