import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { REDACTION_CENSOR, REDACTION_PATHS } from "./redaction";
import { getContext, newCorrelationId, runWithContext } from "./logger";

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  const logger = pino(
    {
      redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
      mixin: () => ({ ...(getContext() ?? {}) }),
    },
    stream,
  );
  return { logger, lines };
}

describe("logger", () => {
  it("não vaza credenciais de provedores externos", () => {
    const { logger, lines } = captureLogs();

    logger.info({
      password: "senha-super-secreta",
      metaAccessToken: "EAAG-token-real",
      sipPassword: "senha-do-trunk",
      credentials: { secretAccessKey: "minio-secret" },
      to: "5511999999999",
    });

    const [entry] = lines;
    expect(entry).toBeDefined();
    expect(entry!.password).toBe(REDACTION_CENSOR);
    expect(entry!.metaAccessToken).toBe(REDACTION_CENSOR);
    expect(entry!.sipPassword).toBe(REDACTION_CENSOR);
    expect((entry!.credentials as Record<string, unknown>).secretAccessKey).toBe(
      REDACTION_CENSOR,
    );

    // Dado de negócio continua visível — a censura é só de segredo.
    expect(entry!.to).toBe("5511999999999");

    expect(JSON.stringify(entry)).not.toContain("senha-super-secreta");
    expect(JSON.stringify(entry)).not.toContain("EAAG-token-real");
  });

  it("censura authorization vindo de headers de requisição", () => {
    const { logger, lines } = captureLogs();

    logger.info({ req: { headers: { authorization: "Bearer abc.def.ghi" } } });

    expect(JSON.stringify(lines[0])).not.toContain("abc.def.ghi");
  });

  it("propaga correlationId e organizationId para toda linha do contexto", () => {
    const { logger, lines } = captureLogs();
    const correlationId = newCorrelationId();

    runWithContext({ correlationId, organizationId: "org-1" }, () => {
      logger.info("processando");
    });

    expect(lines[0]!.correlationId).toBe(correlationId);
    expect(lines[0]!.organizationId).toBe("org-1");
  });

  it("não vaza contexto entre execuções isoladas", () => {
    const { logger, lines } = captureLogs();

    runWithContext({ correlationId: "a", organizationId: "org-a" }, () => {
      logger.info("dentro");
    });
    logger.info("fora");

    expect(lines[0]!.organizationId).toBe("org-a");
    expect(lines[1]!.organizationId).toBeUndefined();
  });
});
