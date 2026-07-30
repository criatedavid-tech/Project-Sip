import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  WHATSAPP_PROVIDER,
  ProviderError,
  type WhatsAppProvider,
} from "@omni/provider-contracts";
import { schema, withOrganization, type Database } from "@omni/db";
import { DATABASE } from "../database/database.module";
import { isWithinServiceWindow } from "../whatsapp/inbound-message.service";

const PROVIDER = "meta_cloud_api";

export interface ConversationListItem {
  id: string;
  status: string;
  contactId: string;
  contactName: string | null;
  contactIdentifier: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  withinServiceWindow: boolean;
  unreadCount: number;
  lastMessagePreview: string | null;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async list(organizationId: string, limit = 50): Promise<ConversationListItem[]> {
    return withOrganization(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.conversations.id,
          status: schema.conversations.status,
          contactId: schema.contacts.id,
          contactName: schema.contacts.name,
          contactIdentifier: schema.contactChannels.identifier,
          lastMessageAt: schema.conversations.lastMessageAt,
          lastInboundAt: schema.conversations.lastInboundAt,
        })
        .from(schema.conversations)
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
        .leftJoin(
          schema.contactChannels,
          and(
            eq(schema.contactChannels.contactId, schema.contacts.id),
            eq(schema.contactChannels.channelType, "whatsapp"),
          ),
        )
        .where(eq(schema.conversations.channelType, "whatsapp"))
        .orderBy(desc(schema.conversations.lastMessageAt))
        .limit(limit);

      // Uma consulta só para as prévias, em vez de uma por conversa.
      const previews = await tx.execute<{
        conversation_id: string;
        body: string | null;
        unread: number;
      }>(sql`
        select m.conversation_id,
               (array_agg(m.body order by m.created_at desc))[1] as body,
               count(*) filter (
                 where m.direction = 'inbound' and m.read_at is null
               )::int as unread
        from messages m
        group by m.conversation_id
      `);

      const byConversation = new Map(previews.map((row) => [row.conversation_id, row]));

      return rows.map((row) => {
        const preview = byConversation.get(row.id);
        return {
          ...row,
          withinServiceWindow: isWithinServiceWindow(row.lastInboundAt),
          unreadCount: preview?.unread ?? 0,
          lastMessagePreview: preview?.body ?? null,
        };
      });
    });
  }

  async messages(organizationId: string, conversationId: string, limit = 100) {
    return withOrganization(this.db, organizationId, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .limit(1);

      // Conversa de outra organização é invisível pelo RLS, então "não existe"
      // é a resposta correta — e não revela que ela existe em outro tenant.
      if (!conversation) {
        throw new NotFoundException("conversa não encontrada");
      }

      const rows = await tx
        .select({
          id: schema.messages.id,
          direction: schema.messages.direction,
          senderType: schema.messages.senderType,
          contentType: schema.messages.contentType,
          body: schema.messages.body,
          status: schema.messages.status,
          errorMessage: schema.messages.errorMessage,
          createdAt: schema.messages.createdAt,
          sentAt: schema.messages.sentAt,
          deliveredAt: schema.messages.deliveredAt,
          readAt: schema.messages.readAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(schema.messages.createdAt)
        .limit(limit);

      return {
        conversation: {
          id: conversation.id,
          status: conversation.status,
          lastInboundAt: conversation.lastInboundAt,
          withinServiceWindow: isWithinServiceWindow(conversation.lastInboundAt),
        },
        messages: rows,
      };
    });
  }

  async sendText(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    body: string;
  }) {
    const { organizationId, conversationId, userId } = params;
    const body = params.body.trim();

    if (!body) {
      throw new BadRequestException("mensagem vazia");
    }

    const prepared = await withOrganization(this.db, organizationId, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .limit(1);

      if (!conversation) {
        throw new NotFoundException("conversa não encontrada");
      }

      // Fora da janela de 24h a Meta só aceita template. Bloquear aqui evita
      // gastar uma tentativa que voltaria como erro e confundiria o atendente.
      if (!isWithinServiceWindow(conversation.lastInboundAt)) {
        throw new BadRequestException(
          "fora da janela de 24 horas: use um template aprovado",
        );
      }

      const [channel] = await tx
        .select({ identifier: schema.contactChannels.identifier })
        .from(schema.contactChannels)
        .where(
          and(
            eq(schema.contactChannels.contactId, conversation.contactId),
            eq(schema.contactChannels.channelType, "whatsapp"),
          ),
        )
        .limit(1);

      if (!channel) {
        throw new BadRequestException("contato sem número de WhatsApp");
      }

      const idempotencyKey = `outbound:${randomUUID()}`;

      // A mensagem nasce 'queued' e persistida ANTES do envio: se a chamada à
      // Meta falhar, o atendente vê a tentativa e o erro, em vez de a mensagem
      // simplesmente sumir.
      const [message] = await tx
        .insert(schema.messages)
        .values({
          organizationId,
          conversationId,
          direction: "outbound",
          senderType: "user",
          senderUserId: userId,
          contentType: "text",
          body,
          provider: PROVIDER,
          idempotencyKey,
          status: "queued",
        })
        .returning({ id: schema.messages.id });

      return { messageId: message!.id, to: channel.identifier, idempotencyKey };
    });

    try {
      const result = await this.whatsapp.sendText({
        to: prepared.to,
        body,
        idempotencyKey: prepared.idempotencyKey,
      });

      return withOrganization(this.db, organizationId, async (tx) => {
        const [updated] = await tx
          .update(schema.messages)
          .set({
            providerMessageId: result.providerMessageId,
            status: result.status,
            sentAt: result.acceptedAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.messages.id, prepared.messageId))
          .returning();

        await tx
          .update(schema.conversations)
          .set({ lastMessageAt: result.acceptedAt, updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));

        return updated;
      });
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;

      return withOrganization(this.db, organizationId, async (tx) => {
        const [failed] = await tx
          .update(schema.messages)
          .set({
            status: "failed",
            errorCode: providerError?.code ?? "UNKNOWN",
            errorMessage:
              providerError?.message ??
              (error instanceof Error ? error.message : String(error)),
            updatedAt: new Date(),
          })
          .where(eq(schema.messages.id, prepared.messageId))
          .returning();

        return failed;
      });
    }
  }

  async markRead(organizationId: string, conversationId: string): Promise<void> {
    await withOrganization(this.db, organizationId, async (tx) => {
      await tx
        .update(schema.messages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.direction, "inbound"),
            sql`${schema.messages.readAt} is null`,
          ),
        );
    });
  }
}
