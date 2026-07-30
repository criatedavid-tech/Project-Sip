import { z } from "zod";

const providerDriver = z.enum(["mock", "real"]).default("mock");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Segredo curto derruba a segurança do JWT inteiro, então o piso é validado
  // na subida do processo e não em runtime.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  SIP_PROVIDER_DRIVER: providerDriver,
  WHATSAPP_PROVIDER_DRIVER: providerDriver,
  TRANSCRIPTION_PROVIDER_DRIVER: providerDriver,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    // Lista todos os problemas de uma vez; corrigir .env um erro por vez é ruim.
    // Só os nomes das variáveis aparecem — nunca os valores, que podem ser segredo.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }

  return parsed.data;
}

export function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam ser diferentes");
  }
}
