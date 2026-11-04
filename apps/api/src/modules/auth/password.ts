import { hash, verify } from '@node-rs/argon2';

// Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 iteraciones).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Gasta el mismo tiempo que una verificación real, para no revelar si el correo existe. */
export async function dummyVerify(plain: string): Promise<void> {
  dummyHash ??= hashPassword('contrasena-ficticia-para-igualar-tiempos');
  await verifyPassword(await dummyHash, plain);
}
