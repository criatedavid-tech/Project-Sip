import { relations, sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";
import { users } from "./users";
import { contacts } from "./contacts";
import { whatsappAccounts } from "./channels";

export const conversations = pgTable(
  "conversations",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** 'whatsapp' | 'voice' — os dois canais só se encontram no contato. */
    channelType: text("channel_type").notNull(),
    whatsappAccountId: uuid("whatsapp_account_id").references(() => whatsappAccounts.id),
    phoneNumberId: uuid("phone_number_id"),
    status: text("status").notNull().default("open"),
    currentAssigneeId: uuid("current_assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Momento da última mensagem recebida do contato. É daqui que sai a janela
     * de 24 horas da Meta, dentro da qual se pode responder com texto livre.
     */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Uma conversa aberta por contato e canal: sem isso, duas mensagens
    // recebidas quase ao mesmo tempo criariam threads paralelas.
    uniqueIndex("conversations_open_unique")
      .on(table.organizationId, table.contactId, table.channelType)
      .where(sql`status in ('open', 'pending')`),
    index("conversations_org_status_idx").on(table.organizationId, table.status),
    index("conversations_org_last_message_idx").on(
      table.organizationId,
      table.lastMessageAt,
    ),
    index("conversations_assignee_idx").on(table.currentAssigneeId),
  ],
);

export const conversationAssignments = pgTable(
  "conversation_assignments",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    assignedById: uuid("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  },
  (table) => [index("conversation_assignments_conversation_idx").on(table.conversationId)],
);

export const messages = pgTable(
  "messages",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    senderType: text("sender_type").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contentType: text("content_type").notNull(),
    body: text("body"),
    mediaFileId: uuid("media_file_id"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    /** Impede envio duplicado quando a fila reprocessa o mesmo job. */
    idempotencyKey: text("idempotency_key").notNull(),
    replyToMessageId: uuid("reply_to_message_id"),
    status: text("status").notNull().default("queued"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("messages_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    // Reentrega de webhook é normal na Meta; esta é a defesa real contra
    // duplicar a mesma mensagem recebida.
    uniqueIndex("messages_provider_message_unique")
      .on(table.organizationId, table.provider, table.providerMessageId)
      .where(sql`provider_message_id is not null`),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const messageStatusEvents = pgTable(
  "message_status_events",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    providerEventId: text("provider_event_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    rawPayload: jsonb("raw_payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    // Deduplica reentrega do mesmo status pelo provedor.
    uniqueIndex("message_status_events_unique").on(
      table.messageId,
      table.status,
      table.providerEventId,
    ),
    index("message_status_events_message_idx").on(table.messageId, table.occurredAt),
  ],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  contact: one(contacts, {
    fields: [conversations.contactId],
    references: [contacts.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  statusEvents: many(messageStatusEvents),
}));
