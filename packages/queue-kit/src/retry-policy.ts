import type { JobsOptions } from "bullmq";

export interface RetryPolicy {
  attempts: number;
  backoffDelayMs: number;
  /** Mantém histórico curto no Redis; o que importa a longo prazo vai pro Postgres. */
  keepCompleted: number;
  keepFailed: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 5,
  backoffDelayMs: 5000,
  keepCompleted: 100,
  keepFailed: 500,
};

/**
 * O BullMQ usa ":" como separador de chaves no Redis e recusa jobId que o
 * contenha — silenciosamente, dentro de uma promise. Como a convenção natural
 * das nossas chaves de idempotência é "upload:rec-1", normalizamos aqui em vez
 * de exigir que cada chamador lembre da restrição.
 */
export function sanitizeJobId(jobId: string): string {
  return jobId.replace(/:/g, "-");
}

export function buildJobOptions(
  policy: RetryPolicy,
  jobId: string,
  overrides: JobsOptions = {},
): JobsOptions {
  return {
    jobId: sanitizeJobId(jobId),
    attempts: policy.attempts,
    backoff: { type: "exponential", delay: policy.backoffDelayMs },
    removeOnComplete: policy.keepCompleted,
    removeOnFail: policy.keepFailed,
    ...overrides,
  };
}

/**
 * BullMQ não tem dead-letter queue nativa: só movemos o job quando ele
 * esgotou de fato as tentativas, senão a DLQ encheria de falhas transitórias.
 */
export function hasExhaustedAttempts(
  attemptsMade: number,
  configuredAttempts: number | undefined,
): boolean {
  return attemptsMade >= (configuredAttempts ?? 1);
}
