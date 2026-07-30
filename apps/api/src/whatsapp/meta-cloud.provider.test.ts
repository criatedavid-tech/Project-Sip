import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@omni/provider-contracts";
import { MetaCloudApiProvider } from "./meta-cloud.provider";

const APP_SECRET = "segredo-do-app-meta";

function makeProvider(fetchImpl?: typeof fetch) {
  return new MetaCloudApiProvider({
    accessToken: "token-de-acesso",
    phoneNumberId: "1234567890",
    appSecret: APP_SECRET,
    webhookVerifyToken: "token-de-verificacao",
    fetchImpl,
    baseUrl: "https://graph.test",
  });
}

function sign(body: Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function okResponse(id = "wamid.ABC") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id }] }),
    text: async () => "",
  } as unknown as Response;
}

/** Payload real de mensagem de texto recebida, formato da Cloud API. */
const inboundTextPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "551133334444",
              phone_number_id: "1234567890",
            },
            contacts: [{ profile: { name: "Joana Ribeiro" }, wa_id: "5511988887777" }],
            messages: [
              {
                from: "5511988887777",
                id: "wamid.HBgNNTUxMTk4ODg4Nzc3NxUCABIYFjNBMEQ2QTk5",
                timestamp: "1785446400",
                text: { body: "Bom dia, gostaria de informações." },
                type: "text",
              },
            ],
          },
        },
      ],
    },
  ],
};

const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "551133334444",
              phone_number_id: "1234567890",
            },
            statuses: [
              {
                id: "wamid.HBgNNTUxMTk4ODg4Nzc3Nw",
                status: "delivered",
                timestamp: "1785446460",
                recipient_id: "5511988887777",
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("verificação de assinatura", () => {
  it("aceita assinatura correta sobre o corpo cru", () => {
    const provider = makeProvider();
    const body = Buffer.from(JSON.stringify(inboundTextPayload));

    expect(provider.verifySignature(body, sign(body))).toBe(true);
  });

  it("recusa assinatura gerada com outro segredo", () => {
    const provider = makeProvider();
    const body = Buffer.from(JSON.stringify(inboundTextPayload));

    expect(provider.verifySignature(body, sign(body, "segredo-do-atacante"))).toBe(false);
  });

  it("recusa quando o corpo é adulterado após a assinatura", () => {
    const provider = makeProvider();
    const original = Buffer.from(JSON.stringify(inboundTextPayload));
    const assinatura = sign(original);
    const adulterado = Buffer.from(
      JSON.stringify(inboundTextPayload).replace("Bom dia", "Boa noite"),
    );

    expect(provider.verifySignature(adulterado, assinatura)).toBe(false);
  });

  it("recusa cabeçalho ausente, vazio ou sem o prefixo sha256", () => {
    const provider = makeProvider();
    const body = Buffer.from("{}");

    expect(provider.verifySignature(body, undefined)).toBe(false);
    expect(provider.verifySignature(body, "")).toBe(false);
    expect(provider.verifySignature(body, "abc123")).toBe(false);
  });

  it("recusa assinatura de tamanho diferente sem lançar", () => {
    const provider = makeProvider();
    const body = Buffer.from("{}");

    expect(() => provider.verifySignature(body, "sha256=abc")).not.toThrow();
    expect(provider.verifySignature(body, "sha256=abc")).toBe(false);
  });
});

describe("verificação do webhook (handshake da Meta)", () => {
  it("aceita apenas mode=subscribe com o token configurado", async () => {
    const provider = makeProvider();

    await expect(
      provider.verifyWebhook({
        mode: "subscribe",
        token: "token-de-verificacao",
        challenge: "42",
      }),
    ).resolves.toBe(true);

    await expect(
      provider.verifyWebhook({ mode: "subscribe", token: "errado", challenge: "42" }),
    ).resolves.toBe(false);

    await expect(
      provider.verifyWebhook({
        mode: "unsubscribe",
        token: "token-de-verificacao",
        challenge: "42",
      }),
    ).resolves.toBe(false);
  });
});

describe("normalização de payloads recebidos", () => {
  it("normaliza mensagem de texto preservando remetente, nome e horário", async () => {
    const provider = makeProvider();
    const [event] = await provider.processWebhook(inboundTextPayload);

    expect(event).toMatchObject({
      type: "message.received",
      providerMessageId: "wamid.HBgNNTUxMTk4ODg4Nzc3NxUCABIYFjNBMEQ2QTk5",
      from: "5511988887777",
      to: "551133334444",
      contentType: "text",
      body: "Bom dia, gostaria de informações.",
      contactName: "Joana Ribeiro",
    });
    expect((event as { occurredAt: Date }).occurredAt.toISOString()).toBe(
      new Date(1785446400 * 1000).toISOString(),
    );
  });

  it("normaliza status de entrega com id de evento estável para dedupe", async () => {
    const provider = makeProvider();
    const [event] = await provider.processWebhook(statusPayload);

    expect(event).toMatchObject({
      type: "message.status",
      providerMessageId: "wamid.HBgNNTUxMTk4ODg4Nzc3Nw",
      status: "delivered",
      providerEventId: "wamid.HBgNNTUxMTk4ODg4Nzc3Nw:delivered:1785446460",
    });
  });

  it("extrai mídia e usa a legenda como corpo", async () => {
    const provider = makeProvider();
    const payload = structuredClone(inboundTextPayload) as Record<string, any>;
    payload.entry[0].changes[0].value.messages[0] = {
      from: "5511988887777",
      id: "wamid.IMG",
      timestamp: "1785446400",
      type: "image",
      image: { id: "media-1", mime_type: "image/jpeg", caption: "segue o comprovante" },
    };

    const [event] = await provider.processWebhook(payload);

    expect(event).toMatchObject({
      contentType: "image",
      mediaId: "media-1",
      mimeType: "image/jpeg",
      body: "segue o comprovante",
    });
  });

  it("marca tipo desconhecido como 'unknown' em vez de descartar a mensagem", async () => {
    const provider = makeProvider();
    const payload = structuredClone(inboundTextPayload) as Record<string, any>;
    payload.entry[0].changes[0].value.messages[0] = {
      from: "5511988887777",
      id: "wamid.NOVO",
      timestamp: "1785446400",
      type: "tipo_que_a_meta_inventou",
    };

    const [event] = await provider.processWebhook(payload);

    expect(event).toMatchObject({ contentType: "unknown", providerMessageId: "wamid.NOVO" });
  });

  it("não converte status desconhecido em falha", async () => {
    const provider = makeProvider();
    const payload = structuredClone(statusPayload) as Record<string, any>;
    payload.entry[0].changes[0].value.statuses[0].status = "status_novo_da_meta";

    const [event] = await provider.processWebhook(payload);

    expect((event as { status: string }).status).not.toBe("failed");
  });

  it("normaliza vários eventos de um mesmo lote", async () => {
    const provider = makeProvider();
    const payload = structuredClone(inboundTextPayload) as Record<string, any>;
    payload.entry[0].changes[0].value.statuses = [
      { id: "wamid.X", status: "read", timestamp: "1785446500" },
    ];

    const events = await provider.processWebhook(payload);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "message.received",
      "message.status",
    ]);
  });

  it("devolve lista vazia para payload que não é da Meta, sem lançar", async () => {
    const provider = makeProvider();

    await expect(provider.processWebhook({ foo: "bar" })).resolves.toEqual([]);
    await expect(provider.processWebhook(null)).resolves.toEqual([]);
  });

  it("ignora notificação sem mensagens nem status", async () => {
    const provider = makeProvider();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }],
        },
      ],
    };

    await expect(provider.processWebhook(payload)).resolves.toEqual([]);
  });
});

describe("envio de mensagens", () => {
  it("envia texto no formato da Cloud API e devolve o wamid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("wamid.ENVIADA"));
    const provider = makeProvider(fetchMock as unknown as typeof fetch);

    const result = await provider.sendText({
      to: "5511988887777",
      body: "Olá!",
      idempotencyKey: "msg-1",
    });

    expect(result.providerMessageId).toBe("wamid.ENVIADA");
    expect(result.status).toBe("submitted");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.test/v21.0/1234567890/messages");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511988887777",
      type: "text",
      text: { preview_url: false, body: "Olá!" },
    });
  });

  it("envia template com idioma e componentes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const provider = makeProvider(fetchMock as unknown as typeof fetch);

    await provider.sendTemplate({
      to: "5511988887777",
      templateName: "boas_vindas",
      languageCode: "pt_BR",
      idempotencyKey: "tpl-1",
      components: [{ type: "body" }],
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).template).toEqual({
      name: "boas_vindas",
      language: { code: "pt_BR" },
      components: [{ type: "body" }],
    });
  });

  it("trata 429 como transitório para a fila retentar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    } as unknown as Response);
    const provider = makeProvider(fetchMock as unknown as typeof fetch);

    await expect(
      provider.sendText({ to: "5511988887777", body: "x", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("trata 400 como definitivo, porque retentar não corrige requisição inválida", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid parameter",
    } as unknown as Response);
    const provider = makeProvider(fetchMock as unknown as typeof fetch);

    await expect(
      provider.sendText({ to: "invalido", body: "x", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("trata falha de rede como transitória", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const provider = makeProvider(fetchMock as unknown as typeof fetch);

    await expect(
      provider.sendText({ to: "5511988887777", body: "x", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ retryable: true, code: "NETWORK" });
  });

  it("recusa envio de mídia sem url nem id", async () => {
    const provider = makeProvider();

    await expect(
      provider.sendMedia({ to: "5511988887777", kind: "image", idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
