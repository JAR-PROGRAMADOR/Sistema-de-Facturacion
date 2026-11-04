import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Implementación de HOTP (RFC 4226) y TOTP (RFC 6238) sin dependencias externas.
// Parámetros estándar: HMAC-SHA1, 6 dígitos, pasos de 30 segundos.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Genera un secreto nuevo de 160 bits (recomendado para HMAC-SHA1), codificado en Base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(keyBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(keyBase32);
  const counterBuf = Buffer.alloc(8);
  // Los contadores de TOTP caben siempre en los 32 bits bajos durante muchísimos años.
  counterBuf.writeUInt32BE(counter, 4);

  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = (binary % 10 ** digits).toString().padStart(digits, '0');
  return otp;
}

export interface TotpOptions {
  stepSeconds?: number;
  digits?: number;
  /** Cuántos pasos antes/después del actual se aceptan (tolerancia de reloj). */
  window?: number;
}

export function generateTotp(secretBase32: string, at: number = Date.now(), opts: TotpOptions = {}): string {
  const step = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const counter = Math.floor(at / 1000 / step);
  return hotp(secretBase32, counter, digits);
}

/** Compara en tiempo constante para no filtrar por timing cuánto del código coincide. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyTotp(secretBase32: string, code: string, opts: TotpOptions = {}): boolean {
  const step = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  if (!/^\d+$/.test(code) || code.length !== digits) return false;

  const counter = Math.floor(Date.now() / 1000 / step);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secretBase32, counter + errorWindow, digits);
    if (safeEqual(candidate, code)) return true;
  }
  return false;
}

export function buildOtpAuthUrl(secretBase32: string, accountEmail: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Códigos de recuperación de un solo uso: 8 códigos tipo XXXX-XXXX. */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(4).toString('hex').toUpperCase(); // 8 caracteres
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return codes;
}
