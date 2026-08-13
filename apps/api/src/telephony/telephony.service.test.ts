import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@omni/auth";
import { REQUIRED_PERMISSIONS } from "../auth/permissions.guard";
import { TelephonyController } from "./telephony.controller";
import {
  buildDashboardMetrics,
  buildDashboardSeries,
  callTiming,
  normalizeDialerPhone,
  parseDashboardFilters,
  parseTelephonyFilters,
  scopedTelephonyUserId,
  summarizeAri,
  webRtcPassword,
} from "./telephony.service";

describe("normalizeDialerPhone", () => {
  it("normaliza números brasileiros locais e com código do país", () => {
    expect(normalizeDialerPhone("(62) 99999-0000")).toBe("5562999990000");
    expect(normalizeDialerPhone("+55 11 3333-4444")).toBe("551133334444");
  });

  it("recusa números incompletos ou com DDD inválido", () => {
    expect(normalizeDialerPhone("9999-0000")).toBeNull();
    expect(normalizeDialerPhone("+55 01 99999-0000")).toBeNull();
  });
});

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
        {
          technology: "PJSIP",
          resource: "nvoip",
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

describe("telephony dashboard", () => {
  const calls = [
    {
      status: "completed",
      direction: "inbound",
      startedAt: "2026-08-13T12:00:00.000Z",
      durationSeconds: 60,
      answerTimeSeconds: 8,
      wrapUpTimeSeconds: null,
    },
    {
      status: "failed",
      direction: "outbound",
      startedAt: "2026-08-13T13:00:00.000Z",
      durationSeconds: null,
      answerTimeSeconds: null,
      wrapUpTimeSeconds: null,
    },
  ];

  it("mantém métricas indisponíveis como nulas sem estimar pós-atendimento", () => {
    expect(buildDashboardMetrics(calls)).toEqual({
      averageHandleTimeSeconds: null,
      totalCalls: 2,
      totalConversationSeconds: 60,
      averageConversationSeconds: 60,
      completedCalls: 1,
      failedCalls: 1,
    });
    expect(
      callTiming({
        startedAt: "2026-08-13T12:00:00.000Z",
        answeredAt: "2026-08-13T12:00:08.000Z",
      }),
    ).toEqual({ answerTimeSeconds: 8, wrapUpTimeSeconds: null });
  });

  it("separa ligações de entrada e saída na série temporal", () => {
    expect(buildDashboardSeries(calls, "hour")).toEqual([
      { key: "2026-08-13T09", label: "09h", inbound: 1, outbound: 0, total: 1 },
      { key: "2026-08-13T10", label: "10h", inbound: 0, outbound: 1, total: 1 },
    ]);
  });

  it("aceita período inclusivo e recusa intervalos invertidos", () => {
    const filters = parseDashboardFilters({
      startDate: "2026-08-01",
      endDate: "2026-08-13",
      granularity: "day",
    });
    expect(filters.start.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(filters.end.toISOString()).toBe("2026-08-14T03:00:00.000Z");
    expect(() =>
      parseDashboardFilters({
        startDate: "2026-08-14",
        endDate: "2026-08-13",
      }),
    ).toThrow("período do dashboard inválido");
  });

  it("exige gestão de usuários e bloqueia o painel para atendentes", () => {
    const required = Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      TelephonyController.prototype.dashboardAdmin,
    ) as string[];
    expect(required).toEqual(
      expect.arrayContaining([
        PERMISSIONS.callsRead,
        PERMISSIONS.recordingsListen,
        PERMISSIONS.transcriptionsRead,
        PERMISSIONS.usersManage,
      ]),
    );
  });
});
