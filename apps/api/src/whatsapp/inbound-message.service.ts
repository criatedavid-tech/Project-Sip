import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  InboundMessageEvent,
  MessageStatusEvent,
  NormalizedWhatsAppEvent,
} from "@omni/provider-contracts";
import { schema, withOrganization, type Database, type Transaction } from "@omni/db";
import { DATABASE } from "../database/database.module";

const PROVIDER = "meta_cloud_api";

/** Estados finais: um webhook atrasado não pode regredir o status exibido. */
const STATUS_ORDER: Record<string, number> = {
  queued: 0,
  submitted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

export interface ApplyResult {
  applied: number;
  skipped: number;
}

@Injectable()
export class InboundMessageService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Resolve a organização pelo phone_number_id que a Meta envia. Sem isso não
   * há tenant, e sem tenant não há como gravar nada sob RLS.
   *
   * Consulta a view whatsapp_routing, e não a tabela: neste ponto ainda não há
   * organização fixada na sessão, então o RLS de whatsapp_accounts esconderia
   * todas as linhas. A view expõe só as três colunas de roteamento.
   */
  async resolveOrganization(phoneNumberId: string): Promise<{
    organizationId: string;
    whatsappAccountId: string;
  } | null> {
    const rows = await this.db.execute<{
      organization_id: string;
      whatsapp_account_id: string;
    }>(sql`
      select organization_id, whatsapp_account_id
      from whatsapp_routing
      where phone_number_id = ${phoneNumberId}
      limit 1
    `);

    const account = rows[0];
    return account
      ? {
          organizationId: account.organization_id,
          whatsappAccountId: account.whatsapp_account_id,
        }
      : null;
  }

  async apply(
    organizationId: string,
    whatsappAccountId: string,
    events: NormalizedWhatsAppEvent[],
  ): Promise<ApplyResult> {
    let applied = 0;
    let skipped = 0;

    for (const event of events) {
      const ok = await withOrganization(this.db, organizationId, (tx) =>
        event.type === "message.received"
          ? this.applyInbound(tx, organizationId, whatsappAccountId, event)
          : this.applyStatus(tx, organizationId, event),
      );
      if (ok) {
        applied += 1;
      } else {
        skipped += 1;
      }
    }

    return { applied, skipped };
  }

  private async applyInbound(
    tx: Transaction,
    organizationId: string,
    whatsappAccountId: string,
    event: InboundMessageEvent,
  ): Promise<boolean> {
    const contactId = await this.upsertContact(tx, organizationId, event);
    const conversationId = await this.upsertConversation(
      tx,
      organizationId,
      whatsappAccountId,
      contactId,
      event.occurredAt,
    );

    const inserted = await tx
      .insert(schema.messages)
      .values({
        organizationId,
        conversationId,
        direction: "inbound",
        senderType: "contact",
        contentType: event.contentType,
        body: event.body ?? null,
        provider: PROVIDER,
        providerMessageId: event.providerMessageId,
        idempotencyKey: `${PROVIDER}:${event.providerMessageId}`,
        status: "received",
        metadata: { mediaId: event.mediaId, mimeType: event.mimeType },
        sentAt: event.occurredAt,
      })
      // A constraint única é a defesa real contra reprocessamento: mesmo que a
      // fila entregue o job duas vezes, a segunda não cria outra mensagem.
      .onConflictDoNothing({
        target: [schema.messages.organizationId, schema.messages.idempotencyKey],
      })
      .returning({ id: schema.messages.id });

    return inserted.length > 0;
  }

  private async applyStatus(
    tx: Transaction,
    organizationId: string,
    event: MessageStatusEvent,
  ): Promise<boolean> {
    const [message] = await tx
      .select({ id: schema.messages.id, status: schema.messages.status })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organizationId, organizationId),
          eq(schema.messages.providerMessageId, event.providerMessageId),
        ),
      )
      .limit(1);

    // Status de mensagem que não conhecemos é comum quando o envio foi feito
    // fora da plataforma; não é erro, apenas nada a atualizar.
    if (!message) {
      return false;
    }

    const recorded = await tx
      .insert(schema.messageStatusEvents)
      .values({
        organizationId,
        messageId: message.id,
        status: event.status,
        providerEventId: event.providerEventId ?? null,
        errorCode: event.errorCode ?? null,
        errorMessage: event.errorMessage ?? null,
        rawPayload: event.raw as object,
        occurredAt: event.occurredAt,
      })
      .onConflictDoNothing({
        target: [
          schema.messageStatusEvents.messageId,
          schema.messageStatusEvents.status,
          schema.messageStatusEvents.providerEventId,
        ],
      })
      .returning({ id: schema.messageStatusEvents.id });

    if (recorded.length === 0) {
      return false;
    }

    // Webhooks chegam fora de ordem: 'delivered' depois de 'read' não pode
    // fazer a interface retroceder.
    const current = STATUS_ORDER[message.status] ?? -1;
    const incoming = STATUS_ORDER[event.status] ?? -1;
    if (incoming > current) {
      await tx
        .update(schema.messages)
        .set({
          status: event.status,
          errorCode: event.errorCode ?? null,
          errorMessage: event.errorMessage ?? null,
          ...(event.status === "delivered" ? { deliveredAt: event.occurredAt } : {}),
          ...(event.status === "read" ? { readAt: event.occurredAt } : {}),
          ...(event.status === "sent" ? { sentAt: event.occurredAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.messages.id, message.id));
    }

    return true;
  }

  private async upsertContact(
    tx: Transaction,
    organizationId: string,
    event: InboundMessageEvent,
  ): Promise<string> {
    const [existing] = await tx
      .select({ contactId: schema.contactChannels.contactId })
      .from(schema.contactChannels)
      .where(
        and(
          eq(schema.contactChannels.organizationId, organizationId),
          eq(schema.contactChannels.channelType, "whatsapp"),
          eq(schema.contactChannels.identifier, event.from),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(schema.contacts)
        .set({ lastInteractionAt: event.occurredAt, updatedAt: new Date() })
        .where(eq(schema.contacts.id, existing.contactId));
      return existing.contactId;
    }

    const [contact] = await tx
      .insert(schema.contacts)
      .values({
        organizationId,
        name: event.contactName ?? null,
        lastInteractionAt: event.occurredAt,
      })
      .returning({ id: schema.contacts.id });

    await tx.insert(schema.contactChannels).values({
      organizationId,
      contactId: contact!.id,
      channelType: "whatsapp",
      identifier: event.from,
      isPrimary: "true",
    });

    return contact!.id;
  }

  private async upsertConversation(
    tx: Transaction,
    organizationId: string,
    whatsappAccountId: string,
    contactId: string,
    occurredAt: Date,
  ): Promise<string> {
    const [open] = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.organizationId, organizationId),
          eq(schema.conversations.contactId, contactId),
          eq(schema.conversations.channelType, "whatsapp"),
          inArray(schema.conversations.status, ["open", "pending"]),
        ),
      )
      .limit(1);

    if (open) {
      await tx
        .update(schema.conversations)
        .set({
          lastInboundAt: occurredAt,
          lastMessageAt: occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversations.id, open.id));
      return open.id;
    }

    const [conversation] = await tx
      .insert(schema.conversations)
      .values({
        organizationId,
        contactId,
        channelType: "whatsapp",
        whatsappAccountId,
        status: "open",
        lastInboundAt: occurredAt,
        lastMessageAt: occurredAt,
      })
      .returning({ id: schema.conversations.id });

    return conversation!.id;
  }
}

/** Janela de atendimento da Meta: 24h desde a última mensagem do contato. */
export function isWithinServiceWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  if (!lastInboundAt) {
    return false;
  }
  return now.getTime() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}
