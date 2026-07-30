export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: Date;
}

/**
 * E.164 sem o "+": apenas dígitos, 8 a 15 posições.
 * Normalização é responsabilidade de quem chama, não do adapter.
 */
export type E164 = string;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly code: string,
    /** Falhas transitórias (timeout, 5xx, rate limit) devem ser reprocessadas pela fila. */
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
