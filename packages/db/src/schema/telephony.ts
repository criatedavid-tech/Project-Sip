import { relations } from "drizzle-orm";
import {
  index,
  integer,
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

/** Ramal individual que identifica quem originou ou recebeu uma chamada. */
export const telephonyExtensions = pgTable(
  "telephony_extensions",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    extension: text("extension").notNull(),
    endpointId: text("endpoint_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("telephony_extensions_org_extension_unique").on(
      table.organizationId,
      table.extension,
    ),
    uniqueIndex("telephony_extensions_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex("telephony_extensions_endpoint_unique").on(table.endpointId),
    index("telephony_extensions_org_idx").on(table.organizationId),
  ],
);

/** Histórico normalizado de chamadas; o áudio fica no storage, nunca no banco. */
export const voiceCalls = pgTable(
  "voice_calls",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    externalCallId: text("external_call_id").notNull(),
    linkedId: text("linked_id"),
    direction: text("direction").notNull(),
    provider: text("provider").notNull().default("unknown"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    status: text("status").notNull().default("ringing"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    extensionId: uuid("extension_id").references(() => telephonyExtensions.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    hangupCause: text("hangup_cause"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("voice_calls_org_external_unique").on(
      table.organizationId,
      table.externalCallId,
    ),
    index("voice_calls_org_started_idx").on(table.organizationId, table.startedAt),
    index("voice_calls_user_idx").on(table.userId, table.startedAt),
  ],
);

/** Metadados do arquivo produzido pelo Asterisk e depois enviado ao storage. */
export const callRecordings = pgTable(
  "call_recordings",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    callId: uuid("call_id")
      .notNull()
      .references(() => voiceCalls.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("audio/wav"),
    sizeBytes: integer("size_bytes"),
    durationSeconds: integer("duration_seconds"),
    status: text("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("call_recordings_call_unique").on(table.callId),
    uniqueIndex("call_recordings_org_storage_unique").on(
      table.organizationId,
      table.storageKey,
    ),
    index("call_recordings_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export interface StoredTranscriptionSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence?: number;
}

/** Texto pesquisável da gravação; o áudio continua fora do banco. */
export const callTranscriptions = pgTable(
  "call_transcriptions",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => callRecordings.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    providerJobId: text("provider_job_id"),
    model: text("model"),
    language: text("language"),
    fullText: text("full_text"),
    segments: jsonb("segments").$type<StoredTranscriptionSegment[]>(),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("call_transcriptions_recording_unique").on(table.recordingId),
    index("call_transcriptions_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("call_transcriptions_retry_idx").on(table.status, table.nextRetryAt),
  ],
);

/** Campanha de discagem progressiva, controlada por supervisor ou administrador. */
export const dialerCampaigns = pgTable(
  "dialer_campaigns",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("twilio"),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("dialer_campaigns_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

/** Contato enfileirado em uma campanha e atribuído a um atendente por vez. */
export const dialerCampaignItems = pgTable(
  "dialer_campaign_items",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => dialerCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    phoneNumber: text("phone_number").notNull(),
    position: integer("position").notNull(),
    status: text("status").notNull().default("pending"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    disposition: text("disposition"),
    notes: text("notes"),
    voiceCallId: uuid("voice_call_id").references(() => voiceCalls.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("dialer_campaign_items_campaign_position_unique").on(
      table.campaignId,
      table.position,
    ),
    index("dialer_campaign_items_queue_idx").on(
      table.organizationId,
      table.campaignId,
      table.status,
      table.position,
    ),
    index("dialer_campaign_items_assigned_idx").on(
      table.assignedUserId,
      table.status,
    ),
  ],
);

export const telephonyExtensionsRelations = relations(
  telephonyExtensions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [telephonyExtensions.userId],
      references: [users.id],
    }),
    calls: many(voiceCalls),
  }),
);

export const voiceCallsRelations = relations(voiceCalls, ({ one }) => ({
  user: one(users, { fields: [voiceCalls.userId], references: [users.id] }),
  extension: one(telephonyExtensions, {
    fields: [voiceCalls.extensionId],
    references: [telephonyExtensions.id],
  }),
  recording: one(callRecordings),
}));

export const callRecordingsRelations = relations(
  callRecordings,
  ({ one }) => ({
    call: one(voiceCalls, {
      fields: [callRecordings.callId],
      references: [voiceCalls.id],
    }),
    transcription: one(callTranscriptions),
  }),
);

export const callTranscriptionsRelations = relations(
  callTranscriptions,
  ({ one }) => ({
    recording: one(callRecordings, {
      fields: [callTranscriptions.recordingId],
      references: [callRecordings.id],
    }),
  }),
);
