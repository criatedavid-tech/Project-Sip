import {
  ProviderError,
  type MessageResult,
  type NormalizedWhatsAppEvent,
  type SendMediaRequest,
  type SendTemplateRequest,
  type SendTextRequest,
  type WebhookVerificationRequest,
  type WhatsAppProvider,
} from "@omni/provider-contracts";

export interface MockWhatsAppOptions {
  verifyToken?: string;
  failSend?: { code: string; retryable: boolean };
}

type SentRecord =
  | { kind: "text"; request: SendTextRequest }
  | { kind: "template"; request: SendTemplateRequest }
  | { kind: "media"; request: SendMediaRequest };

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly sent: SentRecord[] = [];
  private counter = 0;
  /** Mantém a promessa de idempotência do contrato: mesma chave, mesmo resultado. */
  private readonly byIdempotencyKey = new Map<string, MessageResult>();

  constructor(private readonly options: MockWhatsAppOptions = {}) {}

  async sendText(request: SendTextRequest): Promise<MessageResult> {
    return this.record({ kind: "text", request }, request.idempotencyKey);
  }

  async sendTemplate(request: SendTemplateRequest): Promise<MessageResult> {
    return this.record({ kind: "template", request }, request.idempotencyKey);
  }

  async sendMedia(request: SendMediaRequest): Promise<MessageResult> {
    return this.record({ kind: "media", request }, request.idempotencyKey);
  }

  async verifyWebhook(request: WebhookVerificationRequest): Promise<boolean> {
    return (
      request.mode === "subscribe" &&
      request.token === (this.options.verifyToken ?? "mock-verify-token")
    );
  }

  async processWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]> {
    if (payload && typeof payload === "object" && "events" in payload) {
      return (payload as { events: NormalizedWhatsAppEvent[] }).events;
    }
    return [];
  }

  private record(entry: SentRecord, idempotencyKey: string): MessageResult {
    const existing = this.byIdempotencyKey.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    if (this.options.failSend) {
      throw new ProviderError(
        "mock: falha simulada no envio",
        "mock-whatsapp",
        this.options.failSend.code,
        this.options.failSend.retryable,
      );
    }
    this.sent.push(entry);
    this.counter += 1;
    const result: MessageResult = {
      providerMessageId: `mock-wamid-${this.counter}`,
      status: "submitted",
      acceptedAt: new Date(),
    };
    this.byIdempotencyKey.set(idempotencyKey, result);
    return result;
  }
}
