import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './totp.js';

describe('Base32', () => {
  it('codifica y decodifica sin pérdida', () => {
    const original = Buffer.from('hola mundo, esto es una prueba de base32');
    const encoded = base32Encode(original);
    expect(decodeAndCompare(encoded, original)).toBe(true);
  });

  function decodeAndCompare(encoded: string, original: Buffer): boolean {
    const decoded = base32Decode(encoded);
    return Buffer.compare(decoded, original) === 0;
  }
});

describe('TOTP (RFC 6238)', () => {
  it('genera códigos de 6 dígitos', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifica un código recién generado', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rechaza un código incorrecto', () => {
    const secret = generateTotpSecret();
    const real = generateTotp(secret);
    const wrong = real === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it('acepta el código de un paso anterior (tolerancia de reloj)', () => {
    const secret = generateTotpSecret();
    const thirtySecondsAgo = Date.now() - 30_000;
    const previousCode = generateTotp(secret, thirtySecondsAgo);
    expect(verifyTotp(secret, previousCode, { window: 1 })).toBe(true);
  });

  it('rechaza un código fuera de la ventana de tolerancia', () => {
    const secret = generateTotpSecret();
    const farInThePast = Date.now() - 10 * 60_000; // 10 minutos
    const oldCode = generateTotp(secret, farInThePast);
    expect(verifyTotp(secret, oldCode, { window: 1 })).toBe(false);
  });

  it('dos secretos distintos producen (casi siempre) códigos distintos en el mismo instante', () => {
    const now = Date.now();
    const a = generateTotp(generateTotpSecret(), now);
    const b = generateTotp(generateTotpSecret(), now);
    // Con 10^6 combinaciones, una colisión ocasional es posible pero muy rara;
    // esta prueba documenta el comportamiento esperado, no una garantía criptográfica.
    expect(a === b).toBe(false);
  });

  it('construye una URL otpauth:// válida', () => {
    const url = buildOtpAuthUrl('JBSWY3DPEHPK3PXP', 'persona@example.com', 'Facturacion');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=Facturacion');
  });
});

describe('Códigos de recuperación', () => {
  it('genera 8 códigos únicos con el formato XXXX-XXXX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
    expect(new Set(codes).size).toBe(8);
  });
});
