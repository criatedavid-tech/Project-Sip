import argon2 from "argon2";

/**
 * Argon2id é o algoritmo recomendado pela OWASP para senha; os parâmetros
 * seguem o perfil mínimo sugerido (19 MiB, 2 iterações, paralelismo 1).
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Hash malformado não pode ser diferenciado de senha errada para quem chama,
    // sob pena de virar oráculo sobre o estado do registro.
    return false;
  }
}
