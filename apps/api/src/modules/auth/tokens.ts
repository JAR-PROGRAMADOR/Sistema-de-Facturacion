import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Token opaco de 256 bits. Solo su hash se guarda en la base de datos. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Código de activación de 6 dígitos (100000-999999, siempre 6 cifras, sin
 * letras). Es lo que se le da a una empresa o a un usuario para activar su
 * licencia: se escribe a mano, no se copia y pega una clave larga. Como solo
 * hay un millón de códigos posibles, la unicidad se verifica contra la base
 * (ver generateUniqueActivationCode en licenses/service.ts) y el código solo
 * se guarda como su hash SHA-256, igual que los tokens: en claro se muestra
 * una sola vez, al emitirlo.
 */
export function generateActivationCode(): string {
  return String(randomInt(100000, 1_000_000));
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
