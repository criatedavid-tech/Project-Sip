import { z } from "zod";

/**
 * Formato dos webhooks da Meta Cloud API.
 *
 * Modelado com tolerância deliberada: a Meta adiciona campos e tipos de
 * mensagem sem aviso, e um schema rígido faria a plataforma rejeitar eventos
 * legítimos. O que não reconhecemos vira 'unknown' e segue registrado, em vez
 * de derrubar o processamento do lote inteiro.
 */

const profile = z.object({ name: z.string().optional() }).optional();

const contact = z.object({
  wa_id: z.string(),
  profile,
});

const textMessage = z.object({ body: z.string() });

const mediaMessage = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
});

const message = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: textMessage.optional(),
    image: mediaMessage.optional(),
    audio: mediaMessage.optional(),
    video: mediaMessage.optional(),
    document: mediaMessage.optional(),
    sticker: mediaMessage.optional(),
    context: z.object({ id: z.string().optional() }).optional(),
  })
  .passthrough();

const statusError = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  message: z.string().optional(),
});

const status = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    recipient_id: z.string().optional(),
    errors: z.array(statusError).optional(),
    conversation: z.object({ id: z.string().optional() }).optional(),
  })
  .passthrough();

const value = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string(),
      })
      .optional(),
    contacts: z.array(contact).optional(),
    messages: z.array(message).optional(),
    statuses: z.array(status).optional(),
  })
  .passthrough();

const change = z
  .object({
    field: z.string(),
    value,
  })
  .passthrough();

const entry = z
  .object({
    id: z.string(),
    changes: z.array(change),
  })
  .passthrough();

export const metaWebhookSchema = z
  .object({
    object: z.string(),
    entry: z.array(entry),
  })
  .passthrough();

export type MetaWebhookPayload = z.infer<typeof metaWebhookSchema>;
export type MetaMessage = z.infer<typeof message>;
export type MetaStatus = z.infer<typeof status>;

/** A Meta envia epoch em segundos, como string. */
export function parseMetaTimestamp(timestamp: string): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}
