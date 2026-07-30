import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";

/**
 * Toda entrega recebida de um provedor externo, gravada crua antes de qualquer
 * processamento.
 *
 * Serve a três propósitos: deduplicar reentregas (a Meta reenvia quando não
 * recebe 200 rápido), permitir reprocessar sem pedir o evento de volta, e
 * preservar o payload original para auditoria.
 *
 * organization_id é nullable porque o evento chega antes de sabermos a quem
 * pertence — a resolução acontece no processamento, pelo phone_number_id.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: primaryId(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    /** Identificador do evento no provedor; base da deduplicação. */
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type"),
    signatureValid: text("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("received"),
    attempts: text("attempts").notNull().default("0"),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("webhook_deliveries_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("webhook_deliveries_status_idx").on(table.status, table.receivedAt),
  ],
);

/**
 * Outbox transacional: o evento é gravado na MESMA transação do dado de
 * negócio, e um relay separado o enfileira depois.
 *
 * Sem isso, um Redis indisponível entre o commit e o enqueue perderia o job
 * silenciosamente — o banco já teria confirmado a escrita.
 */
export const eventOutbox = pgTable(
  "event_outbox",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    queueName: text("queue_name").notNull(),
    jobId: text("job_id").notNull(),
    payload: jsonb("payload").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    attempts: text("attempts").notNull().default("0"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("event_outbox_job_unique").on(table.queueName, table.jobId),
    index("event_outbox_pending_idx").on(table.dispatchedAt, table.createdAt),
  ],
);
