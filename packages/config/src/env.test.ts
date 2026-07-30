import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://omni:omni@localhost:5432/omni",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_BUCKET: "omni-recordings",
  STORAGE_ACCESS_KEY_ID: "minioadmin",
  STORAGE_SECRET_ACCESS_KEY: "minioadmin",
};

describe("loadEnv", () => {
  it("aplica defaults seguros: drivers começam em mock", () => {
    const env = loadEnv(valid);

    expect(env.SIP_PROVIDER_DRIVER).toBe("mock");
    expect(env.WHATSAPP_PROVIDER_DRIVER).toBe("mock");
    expect(env.TRANSCRIPTION_PROVIDER_DRIVER).toBe("mock");
  });

  it("recusa segredo de JWT curto demais", () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: "curto" })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it("reporta todos os problemas de uma vez", () => {
    let message = "";
    try {
      loadEnv({ ...valid, DATABASE_URL: "não-é-url", STORAGE_BUCKET: "" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("STORAGE_BUCKET");
  });

  it("não expõe o valor do segredo na mensagem de erro", () => {
    let message = "";
    try {
      loadEnv({ ...valid, JWT_ACCESS_SECRET: "segredo-vazado-curto" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain("segredo-vazado-curto");
  });

  it("exige DATABASE_URL", () => {
    const { DATABASE_URL: _omitted, ...semBanco } = valid;
    expect(() => loadEnv(semBanco)).toThrow(/DATABASE_URL/);
  });
});
