import { z } from "zod";

const providerDriver = z.enum(["mock", "real"]).default("mock");
const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = z.preprocess(blankAsUndefined, z.string().min(1).optional());
const transcriptionProvider = z.preprocess(
  blankAsUndefined,
  z.enum(["openai", "whisper_local"]).default("openai"),
);
const transcriptionModel = z.preprocess(
  blankAsUndefined,
  z.string().min(1).default("gpt-4o-transcribe-diarize"),
);
const transcriptionLanguage = z.preprocess(
  blankAsUndefined,
  z.string().regex(/^[a-z]{2}$/i).default("pt"),
);

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

export const telephonyEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_ADMIN_URL: z.string().url(),
    ASTERISK_ARI_URL: z.string().url().default("http://localhost:8088"),
    ASTERISK_ARI_USERNAME: z.string().min(1),
    ASTERISK_ARI_PASSWORD: z.string().min(16),
    ASTERISK_ARI_APP: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default("omnichannel"),
    ASTERISK_ARI_RECONNECT_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    ASTERISK_WSS_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith("ws://") || value.startsWith("wss://"), {
        message: "deve usar ws:// ou wss://",
      })
      .default("ws://localhost:8088/ws"),
    ASTERISK_WEBRTC_DOMAIN: z.string().min(1).default("localhost"),
    ASTERISK_WEBRTC_1001_PASSWORD: z.string().min(12),
    ASTERISK_WEBRTC_1002_PASSWORD: z.string().min(12),
    ASTERISK_WEBRTC_SECRET: optionalSecret,
    ASTERISK_EXTENSION_START: z.coerce.number().int().min(1000).max(8999).default(1001),
    ASTERISK_EXTENSION_END: z.coerce.number().int().min(1001).max(8999).default(1099),
    ASTERISK_RECORDINGS_PATH: z
      .string()
      .min(1)
      .default("infra/.local/asterisk-recordings"),
    TRANSCRIPTION_PROVIDER_DRIVER: providerDriver,
    TRANSCRIPTION_PROVIDER: transcriptionProvider,
    TRANSCRIPTION_API_KEY: optionalSecret,
    TRANSCRIPTION_MODEL: transcriptionModel,
    TRANSCRIPTION_LANGUAGE: transcriptionLanguage,
    TRANSCRIPTION_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),
    TRANSCRIPTION_LOCAL_URL: z
      .string()
      .url()
      .default("http://127.0.0.1:8090/v1/transcriptions"),
    TRANSCRIPTION_BACKLOG_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(60_000),
  })
  .superRefine((env, context) => {
    if (env.ASTERISK_EXTENSION_END < env.ASTERISK_EXTENSION_START) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ASTERISK_EXTENSION_END"],
        message: "deve ser maior ou igual a ASTERISK_EXTENSION_START",
      });
    }
    if (
      env.TRANSCRIPTION_PROVIDER_DRIVER === "real" &&
      env.TRANSCRIPTION_PROVIDER === "openai" &&
      !env.TRANSCRIPTION_API_KEY
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TRANSCRIPTION_API_KEY"],
        message: "obrigatória quando TRANSCRIPTION_PROVIDER=openai",
      });
    }
  });

export type TelephonyEnv = z.infer<typeof telephonyEnvSchema>;

function configurationError(error: z.ZodError): Error {
  // Lista todos os problemas de uma vez, mas nunca inclui os valores recebidos.
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  return new Error(`Configuração inválida:\n${issues}`);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw configurationError(parsed.error);
  }

  return parsed.data;
}

export function loadTelephonyEnv(
  source: NodeJS.ProcessEnv = process.env,
): TelephonyEnv {
  const parsed = telephonyEnvSchema.safeParse(source);

  if (!parsed.success) {
    throw configurationError(parsed.error);
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
