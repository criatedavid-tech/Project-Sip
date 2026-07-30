import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Trilha imutável: nunca sofre update ou delete. Registra também quem ouviu ou
 * baixou uma gravação, exigência de controle de acesso a dado sensível.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    correlationId: text("correlation_id"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_occurred_idx").on(table.organizationId, table.occurredAt),
    index("audit_logs_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);
