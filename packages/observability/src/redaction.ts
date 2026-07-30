/**
 * Campos que nunca podem chegar ao log. Cobre credenciais de todos os
 * provedores externos (Meta, SIP trunk, storage, transcrição) e segredos
 * de autenticação da própria plataforma.
 */
const SENSITIVE_FIELDS = [
  "password",
  "senha",
  "secret",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "sipPassword",
  "sip_password",
  "metaAccessToken",
  "metaAppSecret",
  "ariPassword",
  "secretAccessKey",
  "privateKey",
] as const;

const CONTAINERS = ["", "req.headers.", "request.headers.", "headers.", "body.", "config.", "credentials."];

export const REDACTION_PATHS: string[] = CONTAINERS.flatMap((prefix) =>
  SENSITIVE_FIELDS.map((field) => `${prefix}${field}`),
).concat([
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.authorization",
]);

export const REDACTION_CENSOR = "[REDACTED]";
