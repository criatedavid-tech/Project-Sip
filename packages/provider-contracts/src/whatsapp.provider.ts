import type { E164 } from "./common";

export type MessageDeliveryStatus =
  | "queued"
  | "submitted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "received";

export type MediaKind = "image" | "audio" | "video" | "document" | "sticker";

export interface SendTextRequest {
  to: E164;
  body: string;
  /** Deduplica reenvios: o adapter nunca deve enviar duas vezes a mesma chave. */
  idempotencyKey: string;
  replyToProviderMessageId?: string;
}

export interface SendTemplateRequest {
  to: E164;
  templateName: string;
  languageCode: string;
  idempotencyKey: string;
  components?: unknown[];
}

export interface SendMediaRequest {
  to: E164;
  kind: MediaKind;
  idempotencyKey: string;
  /** URL acessível pelo provedor, ou id de mídia previamente enviada. */
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export interface MessageResult {
  providerMessageId: string;
  status: MessageDeliveryStatus;
  acceptedAt: Date;
}

export interface WebhookVerificationRequest {
  mode: string;
  token: string;
  challenge: string;
}

export interface InboundMessageEvent {
  type: "message.received";
  providerMessageId: string;
  from: E164;
  to: E164;
  contentType: "text" | MediaKind | "location" | "contacts" | "interactive" | "unknown";
  body?: string;
  mediaId?: string;
  mimeType?: string;
  contactName?: string;
  occurredAt: Date;
  raw: unknown;
}

export interface MessageStatusEvent {
  type: "message.status";
  providerMessageId: string;
  status: MessageDeliveryStatus;
  /** Presente nos webhooks da Meta; usado para deduplicar reentregas. */
  providerEventId?: string;
  errorCode?: string;
  errorMessage?: string;
  occurredAt: Date;
  raw: unknown;
}

export type NormalizedWhatsAppEvent = InboundMessageEvent | MessageStatusEvent;

export const WHATSAPP_PROVIDER = Symbol("WhatsAppProvider");

export interface WhatsAppProvider {
  sendText(request: SendTextRequest): Promise<MessageResult>;
  sendTemplate(request: SendTemplateRequest): Promise<MessageResult>;
  sendMedia(request: SendMediaRequest): Promise<MessageResult>;
  verifyWebhook(request: WebhookVerificationRequest): Promise<boolean>;
  processWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]>;
}
