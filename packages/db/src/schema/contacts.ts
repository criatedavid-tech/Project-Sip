import { relations } from "drizzle-orm";
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

export const contacts = pgTable(
  "contacts",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    company: text("company"),
    notes: text("notes"),
    customFields: jsonb("custom_fields").notNull().default({}),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("contacts_org_idx").on(table.organizationId),
    index("contacts_org_last_interaction_idx").on(
      table.organizationId,
      table.lastInteractionAt,
    ),
  ],
);

/**
 * Um contato pode ser alcançado por vários canais e identificadores. Manter
 * isso fora de `contacts` é o que permite unificar telefone e WhatsApp numa
 * mesma pessoa sem duplicar o cadastro.
 */
export const contactChannels = pgTable(
  "contact_channels",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelType: text("channel_type").notNull(),
    /** Sempre E.164 sem "+", para telefone e WhatsApp. */
    identifier: text("identifier").notNull(),
    isPrimary: text("is_primary"),
    ...timestamps,
  },
  (table) => [
    // O mesmo número não pode apontar para dois contatos dentro da organização,
    // senão o histórico unificado se parte em dois.
    uniqueIndex("contact_channels_identifier_unique").on(
      table.organizationId,
      table.channelType,
      table.identifier,
    ),
    index("contact_channels_contact_idx").on(table.contactId),
  ],
);

export const contactsRelations = relations(contacts, ({ many }) => ({
  channels: many(contactChannels),
}));

export const contactChannelsRelations = relations(contactChannels, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactChannels.contactId],
    references: [contacts.id],
  }),
}));
