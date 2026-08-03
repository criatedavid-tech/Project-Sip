import { describe, expect, it } from "vitest";
import { loadEnv, loadTelephonyEnv } from "./env";

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

describe("loadTelephonyEnv", () => {
  const telephony = {
    DATABASE_ADMIN_URL: "postgres://omni:omni@localhost:5432/omni",
    ASTERISK_ARI_USERNAME: "omni_ari",
    ASTERISK_ARI_PASSWORD: "a".repeat(32),
    ASTERISK_WEBRTC_1001_PASSWORD: "b".repeat(32),
    ASTERISK_WEBRTC_1002_PASSWORD: "c".repeat(32),
  };

  it("carrega somente a configuração necessária ao worker", () => {
    const env = loadTelephonyEnv(telephony);

    expect(env.ASTERISK_ARI_URL).toBe("http://localhost:8088");
    expect(env.ASTERISK_ARI_APP).toBe("omnichannel");
    expect(env.ASTERISK_ARI_RECONNECT_DELAY_MS).toBe(5_000);
    expect(env.ASTERISK_WSS_URL).toBe("ws://localhost:8088/ws");
    expect(env.ASTERISK_RECORDINGS_PATH).toBe(
      "infra/.local/asterisk-recordings",
    );
    expect(env.TRANSCRIPTION_PROVIDER_DRIVER).toBe("mock");
    expect(env.TRANSCRIPTION_PROVIDER).toBe("openai");
    expect(env.TRANSCRIPTION_MODEL).toBe("gpt-4o-transcribe-diarize");
    expect(env.TRANSCRIPTION_LANGUAGE).toBe("pt");
    expect(env.TRANSCRIPTION_LOCAL_URL).toBe(
      "http://127.0.0.1:8090/v1/transcriptions",
    );
    expect(env.TRANSCRIPTION_BACKLOG_INTERVAL_MS).toBe(60_000);
  });

  it("exige chave somente quando a transcrição real usa OpenAI", () => {
    expect(() =>
      loadTelephonyEnv({
        ...telephony,
        TRANSCRIPTION_PROVIDER_DRIVER: "real",
        TRANSCRIPTION_PROVIDER: "openai",
        TRANSCRIPTION_API_KEY: "",
      }),
    ).toThrow(/TRANSCRIPTION_API_KEY/);

    expect(
      loadTelephonyEnv({
        ...telephony,
        TRANSCRIPTION_PROVIDER_DRIVER: "real",
        TRANSCRIPTION_PROVIDER: "openai",
        TRANSCRIPTION_API_KEY: "chave-de-teste",
      }).TRANSCRIPTION_API_KEY,
    ).toBe("chave-de-teste");

    expect(
      loadTelephonyEnv({
        ...telephony,
        TRANSCRIPTION_PROVIDER_DRIVER: "real",
        TRANSCRIPTION_PROVIDER: "whisper_local",
        TRANSCRIPTION_API_KEY: "",
      }).TRANSCRIPTION_PROVIDER,
    ).toBe("whisper_local");
  });

  it("recusa senha ARI fraca sem expor seu valor", () => {
    let message = "";
    try {
      loadTelephonyEnv({ ...telephony, ASTERISK_ARI_PASSWORD: "senha-curta" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("ASTERISK_ARI_PASSWORD");
    expect(message).not.toContain("senha-curta");
  });

  it("recusa nome de aplicação que não é seguro para o dialplan", () => {
    expect(() =>
      loadTelephonyEnv({ ...telephony, ASTERISK_ARI_APP: "omni channel" }),
    ).toThrow(/ASTERISK_ARI_APP/);
  });

  it("recusa transporte WebRTC fora de WebSocket", () => {
    expect(() =>
      loadTelephonyEnv({ ...telephony, ASTERISK_WSS_URL: "https://localhost/ws" }),
    ).toThrow(/ASTERISK_WSS_URL/);
  });
});
