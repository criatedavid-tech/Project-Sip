import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@omni/db";
import { DATABASE } from "../database/database.module";

const optionalText = z.string().trim().min(1).optional();
const nullableText = z.string().trim().min(1).nullable().optional();

export const voiceWebhookEventSchema = z
  .object({
    event: z.string().trim().min(1),
    id_session: z.number().int().nonnegative(),
    type: z.enum(["CALL", "RECORD", "DEVICE"]),
    action: z.enum(["CREATE", "UPDATE"]),
    id: optionalText,
    whatsapp_call_id: optionalText,
    id_user: z.number().int().optional(),
    caller: optionalText,
    receiver: optionalText,
    status: optionalText,
    direction: z.enum(["INCOMING", "OUTCOMING"]).optional(),
    duration: z.number().int().nonnegative().optional(),
    reason: optionalText,
    record_status: optionalText,
    record_url: z.string().url().optional(),
    phone: optionalText,
    timelock_type: nullableText,
    timelock_expiration: z.string().datetime().nullable().optional(),
  })
  .passthrough();

export type VoiceWebhookEvent = z.infer<typeof voiceWebhookEventSchema>;

export interface WhatsAppVoiceStatus {
  webhookConfigured: boolean;
  connected: boolean | null;
  deviceStatus: string | null;
  lastEventAt: Date | null;
  sessionId: number | null;
  restriction: {
    type: string;
    expiresAt: string | null;
  } | null;
}

export function normalizeVoiceNumber(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function accountNumberForEvent(event: VoiceWebhookEvent): string | null {
  if (event.type === "DEVICE" && event.phone) {
    return normalizeVoiceNumber(event.phone);
  }
  if (event.direction === "INCOMING") {
    return normalizeVoiceNumber(event.receiver);
  }
  if (event.direction === "OUTCOMING") {
    return normalizeVoiceNumber(event.caller);
  }
  return null;
}

export function deviceConnectionFromEvent(
  event: VoiceWebhookEvent,
): boolean | null {
  if (event.type !== "DEVICE") return null;
  if (event.event === "device.opened" || event.status?.toLowerCase() === "open") {
    return true;
  }
  if (
    [
      "device.closed",
      "device.hibernated",
      "device.connecting",
      "device.building",
      "device.restarting",
      "device.waiting_payment",
      "device.overdue",
      "device.error",
      "device.logged-out",
    ].includes(event.event)
  ) {
    return false;
  }
  return null;
}

/**
 * O provedor de voz não documenta assinatura HMAC. Por isso a URL configurada
 * nele recebe um token longo e aleatório, comparado em tempo constante aqui.
 */
export function validVoiceWebhookToken(
  received: string | undefined,
  expected: string | undefined = process.env.WHATSAPP_VOICE_WEBHOOK_TOKEN,
): boolean {
  if (!received || !expected || expected.length < 32) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

@Injectable()
export class VoiceWebhookService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * O roteamento usa somente o número da conta, exposto pela view mínima de
   * roteamento. A consulta acontece antes de existir um tenant na sessão RLS.
   */
  async resolveOrganization(event: VoiceWebhookEvent): Promise<string | null> {
    const configuredOrganizationId =
      process.env.WHATSAPP_VOICE_ORGANIZATION_ID?.trim();
    if (configuredOrganizationId) {
      if (!z.string().uuid().safeParse(configuredOrganizationId).success) {
        throw new Error("WHATSAPP_VOICE_ORGANIZATION_ID inválido");
      }
      return configuredOrganizationId;
    }

    const accountNumber = accountNumberForEvent(event);
    if (accountNumber) {
      const rows = await this.db.execute<{ organization_id: string }>(sql`
        select organization_id
        from whatsapp_routing
        where regexp_replace(phone_number, '[^0-9]', '', 'g') = ${accountNumber}
        limit 1
      `);
      if (rows[0]) return rows[0].organization_id;
    }

    // Eventos de gravação e alguns estados do dispositivo não carregam o
    // número. Depois do primeiro evento roteado, a sessão passa a ser a chave
    // segura para atribuir as entregas seguintes ao mesmo tenant.
    const sessionRows = await this.db.execute<{ organization_id: string }>(sql`
      select organization_id
      from webhook_deliveries
      where provider = 'whatsapp_voice'
        and organization_id is not null
        and payload ->> 'id_session' = ${String(event.id_session)}
      order by received_at desc
      limit 1
    `);
    return sessionRows[0]?.organization_id ?? null;
  }

  async status(organizationId: string): Promise<WhatsAppVoiceStatus> {
    const deliveries = await this.db
      .select({
        payload: schema.webhookDeliveries.payload,
        receivedAt: schema.webhookDeliveries.receivedAt,
      })
      .from(schema.webhookDeliveries)
      .where(
        and(
          eq(schema.webhookDeliveries.organizationId, organizationId),
          eq(schema.webhookDeliveries.provider, "whatsapp_voice"),
          like(schema.webhookDeliveries.eventType, "device.%"),
        ),
      )
      .orderBy(desc(schema.webhookDeliveries.receivedAt))
      .limit(50);

    const events = deliveries.flatMap((delivery) => {
      const parsed = voiceWebhookEventSchema.safeParse(delivery.payload);
      return parsed.success && parsed.data.type === "DEVICE" ? [parsed.data] : [];
    });
    const connectionEvent = events.find(
      (event) => deviceConnectionFromEvent(event) !== null,
    );
    const restrictionEvent = events.find(
      (event) => event.event === "device.timelock_updated",
    );
    const connected = connectionEvent
      ? deviceConnectionFromEvent(connectionEvent)
      : null;
    const deviceStatus = connectionEvent
      ? connectionEvent.status?.toLowerCase() ??
        connectionEvent.event.replace("device.", "")
      : null;
    const restriction = restrictionEvent?.timelock_type
      ? {
          type: restrictionEvent.timelock_type,
          expiresAt: restrictionEvent.timelock_expiration ?? null,
        }
      : null;

    return {
      webhookConfigured:
        (process.env.WHATSAPP_VOICE_WEBHOOK_TOKEN?.trim().length ?? 0) >= 32,
      connected,
      deviceStatus,
      lastEventAt: deliveries[0]?.receivedAt ?? null,
      sessionId: events[0]?.id_session ?? null,
      restriction,
    };
  }
}
