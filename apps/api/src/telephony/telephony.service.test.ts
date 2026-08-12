import { describe, expect, it } from "vitest";
import {
  parseTelephonyFilters,
  scopedTelephonyUserId,
  summarizeAri,
  webRtcPassword,
} from "./telephony.service";

describe("summarizeAri", () => {
  it("traduz o estado real do tronco, ramais e canais ativos", () => {
    const result = summarizeAri({
      info: { system: { version: "20.15.2" } },
      endpoints: [
        { technology: "PJSIP", resource: "1001", state: "offline", channel_ids: [] },
        {
          technology: "PJSIP",
          resource: "directcall",
          state: "online",
          channel_ids: ["trunk-1"],
        },
        {
          technology: "PJSIP",
          resource: "wavoip",
          state: "online",
          channel_ids: [],
        },
        {
          technology: "PJSIP",
          resource: "twilio",
          state: "online",
          channel_ids: [],
        },
      ],
      channels: [{ id: "agent-1" }, { id: "trunk-1" }],
    });

    expect(result.available).toBe(true);
    expect(result.version).toBe("20.15.2");
    expect(result.trunk.status).toBe("online");
    expect(result.trunks).toEqual([
      { endpoint: "directcall", label: "DirectCall", status: "online" },
      { endpoint: "wavoip", label: "WhatsApp", status: "online" },
      { endpoint: "twilio", label: "Twilio", status: "online" },
    ]);
    expect(result.endpointStates["1001"]).toBe("offline");
    expect(result.activeCalls).toBe(1);
  });

  it("trata estado de tronco não reconhecido como desconhecido", () => {
    const result = summarizeAri({
      info: { system: { version: "20" } },
      endpoints: [],
      channels: [],
    });

    expect(result.trunk.status).toBe("unknown");
    expect(result.trunks.every((trunk) => trunk.status === "unknown")).toBe(true);
    expect(result.activeCalls).toBe(0);
  });
});

describe("webRtcPassword", () => {
  const env = {
    ASTERISK_WEBRTC_1001_PASSWORD: "senha-1001",
    ASTERISK_WEBRTC_1002_PASSWORD: "senha-1002",
    ASTERISK_WEBRTC_SECRET: "segredo-mestre-com-mais-de-trinta-e-dois-caracteres",
    ASTERISK_EXTENSION_START: 1001,
    ASTERISK_EXTENSION_END: 1099,
  };

  it("entrega somente a credencial do endpoint conhecido", () => {
    expect(webRtcPassword("1001", env)).toBe("senha-1001");
    expect(webRtcPassword("1003", env)).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(webRtcPassword("9999", env)).toBeUndefined();
  });
});

describe("telephony access scope", () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "22222222-2222-4222-8222-222222222222";

  it("sempre limita o atendente ao próprio usuário", () => {
    expect(
      scopedTelephonyUserId(
        { userId: agentId, roleKey: "agent" },
        otherUserId,
      ),
    ).toBe(agentId);
  });

  it("permite ao administrador consultar a equipe ou um colaborador", () => {
    expect(
      scopedTelephonyUserId({ userId: agentId, roleKey: "admin" }),
    ).toBeUndefined();
    expect(
      scopedTelephonyUserId(
        { userId: agentId, roleKey: "admin" },
        otherUserId,
      ),
    ).toBe(otherUserId);
  });

  it("converte o dia de São Paulo em um intervalo exclusivo de 24 horas", () => {
    const filters = parseTelephonyFilters({ date: "2026-07-31" });

    expect(filters.start?.toISOString()).toBe("2026-07-31T03:00:00.000Z");
    expect(filters.end?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("rejeita uma data inexistente", () => {
    expect(() => parseTelephonyFilters({ date: "2026-02-30" })).toThrow(
      "data inválida",
    );
  });
});
