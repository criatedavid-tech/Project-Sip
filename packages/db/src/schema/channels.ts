import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";

/**
 * Conta do WhatsApp Business ligada à organização.
 *
 * Nenhum segredo mora aqui: o access token e o app secret vivem em variável de
 * ambiente / gerenciador de segredos. A tabela guarda só os identificadores
 * públicos necessários para rotear a mensagem.
 */
export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** Número em E.164 sem "+", como a Meta entrega. */
    phoneNumber: text("phone_number").notNull(),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    provider: text("provider").notNull().default("meta_cloud_api"),
    status: text("status").notNull().default("active"),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // O phone_number_id é o destino dos webhooks: se dois tenants o
    // registrassem, a mensagem recebida cairia na organização errada.
    uniqueIndex("whatsapp_accounts_phone_number_id_unique").on(table.phoneNumberId),
    index("whatsapp_accounts_org_idx").on(table.organizationId),
  ],
);

/** Números de telefonia tradicional (SIP). Populado na Fase 3. */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    label: text("label"),
    kind: text("kind").notNull().default("unknown"),
    sipTrunkId: uuid("sip_trunk_id"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("phone_numbers_unique").on(table.organizationId, table.number),
    index("phone_numbers_org_idx").on(table.organizationId),
  ],
);
