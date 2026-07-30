import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ProviderError,
  type MediaKind,
  type MessageDeliveryStatus,
  type MessageResult,
  type NormalizedWhatsAppEvent,
  type SendMediaRequest,
  type SendTemplateRequest,
  type SendTextRequest,
  type WebhookVerificationRequest,
  type WhatsAppProvider,
} from "@omni/provider-contracts";
import {
  metaWebhookSchema,
  parseMetaTimestamp,
  type MetaMessage,
  type MetaStatus,
} from "./meta-payloads";

export interface MetaCloudOptions {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  webhookVerifyToken: string;
  graphApiVersion?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const PROVIDER = "meta_cloud_api";

/** A Meta usa 'sent' onde o contrato interno também usa; os demais mapeiam direto. */
const STATUS_MAP: Record<string, MessageDeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

const MEDIA_TYPES: MediaKind[] = ["image", "audio", "video", "document", "sticker"];

export class MetaCloudApiProvider implements WhatsAppProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MetaCloudOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendText(request: SendTextRequest): Promise<MessageResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: request.to,
      type: "text",
      text: { preview_url: false, body: request.body },
      ...(request.replyToProviderMessageId
        ? { context: { message_id: request.replyToProviderMessageId } }
        : {}),
    });
  }

  async sendTemplate(request: SendTemplateRequest): Promise<MessageResult> {
    return this.send({
      messaging_product: "whatsapp",
      to: request.to,
      type: "template",
      template: {
        name: request.templateName,
        language: { code: request.languageCode },
        ...(request.components ? { components: request.components } : {}),
      },
    });
  }

  async sendMedia(request: SendMediaRequest): Promise<MessageResult> {
    if (!request.mediaUrl && !request.mediaId) {
      throw new ProviderError(
        "informe mediaUrl ou mediaId",
        PROVIDER,
        "INVALID_REQUEST",
        false,
      );
    }

    const media: Record<string, unknown> = request.mediaId
      ? { id: request.mediaId }
      : { link: request.mediaUrl };
    if (request.caption) {
      media.caption = request.caption;
    }
    if (request.filename) {
      media.filename = request.filename;
    }

    return this.send({
      messaging_product: "whatsapp",
      to: request.to,
      type: request.kind,
      [request.kind]: media,
    });
  }

  async verifyWebhook(request: WebhookVerificationRequest): Promise<boolean> {
    return (
      request.mode === "subscribe" && request.token === this.options.webhookVerifyToken
    );
  }

  /**
   * Verifica a assinatura sobre o corpo CRU. Se o JSON for reserializado antes,
   * a menor diferença de formatação invalida a assinatura — por isso o corpo
   * precisa chegar aqui como Buffer.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith("sha256=")) {
      return false;
    }

    const expected = createHmac("sha256", this.options.appSecret)
      .update(rawBody)
      .digest("hex");
    const received = signatureHeader.slice("sha256=".length);

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");

    // timingSafeEqual exige mesmo tamanho e lança se diferir.
    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  async processWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]> {
    const parsed = metaWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      return [];
    }

    const events: NormalizedWhatsAppEvent[] = [];

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const { value } = change;
        const businessNumber = value.metadata?.display_phone_number ?? "";
        const nameByWaId = new Map(
          (value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name]),
        );

        for (const message of value.messages ?? []) {
          events.push(this.toInboundEvent(message, businessNumber, nameByWaId));
        }
        for (const status of value.statuses ?? []) {
          events.push(this.toStatusEvent(status));
        }
      }
    }

    return events;
  }

  private toInboundEvent(
    message: MetaMessage,
    businessNumber: string,
    nameByWaId: Map<string, string | undefined>,
  ): NormalizedWhatsAppEvent {
    const media = this.extractMedia(message);

    return {
      type: "message.received",
      providerMessageId: message.id,
      from: message.from,
      to: businessNumber,
      contentType: this.toContentType(message.type),
      body: message.text?.body ?? media?.caption,
      mediaId: media?.id,
      mimeType: media?.mime_type,
      contactName: nameByWaId.get(message.from),
      occurredAt: parseMetaTimestamp(message.timestamp),
      raw: message,
    };
  }

  private toStatusEvent(status: MetaStatus): NormalizedWhatsAppEvent {
    const error = status.errors?.[0];

    return {
      type: "message.status",
      providerMessageId: status.id,
      // Status desconhecido não pode virar 'failed': isso marcaria como erro
      // uma mensagem que a Meta apenas descreveu de forma nova.
      status: STATUS_MAP[status.status] ?? "sent",
      providerEventId: `${status.id}:${status.status}:${status.timestamp}`,
      errorCode: error?.code !== undefined ? String(error.code) : undefined,
      errorMessage: error?.title ?? error?.message,
      occurredAt: parseMetaTimestamp(status.timestamp),
      raw: status,
    };
  }

  private extractMedia(message: MetaMessage) {
    for (const kind of MEDIA_TYPES) {
      const media = message[kind];
      if (media) {
        return media;
      }
    }
    return undefined;
  }

  private toContentType(type: string) {
    if (type === "text") {
      return "text" as const;
    }
    if ((MEDIA_TYPES as string[]).includes(type)) {
      return type as MediaKind;
    }
    if (type === "location" || type === "contacts" || type === "interactive") {
      return type;
    }
    return "unknown" as const;
  }

  private async send(body: Record<string, unknown>): Promise<MessageResult> {
    const version = this.options.graphApiVersion ?? "v21.0";
    const base = this.options.baseUrl ?? "https://graph.facebook.com";
    const url = `${base}/${version}/${this.options.phoneNumberId}/messages`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      // Falha de rede é transitória: a fila deve retentar.
      throw new ProviderError("falha de rede ao chamar a Meta", PROVIDER, "NETWORK", true, cause);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(
        `Meta respondeu ${response.status}`,
        PROVIDER,
        String(response.status),
        // 429 e 5xx passam; 4xx restantes são erro nosso e retentar não resolve.
        response.status === 429 || response.status >= 500,
        detail.slice(0, 500),
      );
    }

    const json = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };
    const providerMessageId = json.messages?.[0]?.id;

    if (!providerMessageId) {
      throw new ProviderError(
        "Meta aceitou a chamada sem devolver id da mensagem",
        PROVIDER,
        "MISSING_MESSAGE_ID",
        false,
      );
    }

    return { providerMessageId, status: "submitted", acceptedAt: new Date() };
  }
}
