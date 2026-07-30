import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";

export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Exclusão lógica é intencionalmente restrita: só a organização a tem, para
     * permitir encerrar o tenant sem apagar registros ainda sob prazo legal de
     * retenção. A exclusão definitiva exigida pela LGPD é feita por processo
     * próprio, não por este campo.
     */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const organizationsRelations = relations(organizations, () => ({}));
