import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, buildJobOptions, hasExhaustedAttempts } from "./retry-policy";
import { deadLetterQueueName } from "./queue-names";

describe("buildJobOptions", () => {
  it("usa o jobId como chave de idempotência e aplica backoff exponencial", () => {
    const options = buildJobOptions(DEFAULT_RETRY_POLICY, "upload:rec-1");

    expect(options.jobId).toBe("upload:rec-1");
    expect(options.attempts).toBe(5);
    expect(options.backoff).toEqual({ type: "exponential", delay: 5000 });
  });

  it("permite sobrescrever por fila sem perder os defaults", () => {
    const options = buildJobOptions(DEFAULT_RETRY_POLICY, "send:msg-1", { attempts: 8 });

    expect(options.attempts).toBe(8);
    expect(options.backoff).toEqual({ type: "exponential", delay: 5000 });
  });
});

describe("hasExhaustedAttempts", () => {
  it("não manda para a DLQ enquanto ainda há tentativa disponível", () => {
    expect(hasExhaustedAttempts(1, 5)).toBe(false);
    expect(hasExhaustedAttempts(4, 5)).toBe(false);
  });

  it("manda para a DLQ ao atingir o limite configurado", () => {
    expect(hasExhaustedAttempts(5, 5)).toBe(true);
    expect(hasExhaustedAttempts(6, 5)).toBe(true);
  });

  it("trata fila sem attempts configurado como tentativa única", () => {
    expect(hasExhaustedAttempts(1, undefined)).toBe(true);
    expect(hasExhaustedAttempts(0, undefined)).toBe(false);
  });
});

describe("deadLetterQueueName", () => {
  it("deriva o nome da DLQ da fila de origem", () => {
    expect(deadLetterQueueName("transcription")).toBe("transcription-dlq");
  });
});
