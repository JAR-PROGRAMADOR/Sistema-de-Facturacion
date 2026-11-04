// apps/api/scripts/hash-pwd.ts
import { hashPassword } from '../src/modules/auth/password.js';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

const pwd = process.argv[2];
if (!pwd) {
  console.error('Uso: npx tsx scripts/hash-pwd.ts "TuPassword123!Fuerte"');
  process.exit(1);
}

const hash = await hashPassword(pwd);
console.log(hash);