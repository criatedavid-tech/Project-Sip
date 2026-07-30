-- RLS das tabelas do canal WhatsApp.
--
-- Toda tabela de negocio nova precisa entrar aqui: habilitar RLS sem criar
-- politica bloqueia tudo, e criar a tabela sem habilitar RLS a deixa aberta
-- entre tenants. As duas falhas sao silenciosas, por isso ha um teste que
-- percorre o catalogo e cobra que nenhuma tabela com organization_id fique
-- de fora.
--
-- event_outbox e infraestrutura interna e tem organization_id, entao segue a
-- mesma regra. webhook_deliveries e a excecao deliberada: o evento chega antes
-- de sabermos a que organizacao pertence, e a resolucao acontece no
-- processamento pela conexao administrativa.

--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contacts_tenant_isolation" ON "contacts"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "contact_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contact_channels_tenant_isolation" ON "contact_channels"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "whatsapp_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "whatsapp_accounts_tenant_isolation" ON "whatsapp_accounts"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_numbers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "phone_numbers_tenant_isolation" ON "phone_numbers"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversations_tenant_isolation" ON "conversations"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "conversation_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversation_assignments_tenant_isolation" ON "conversation_assignments"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "messages_tenant_isolation" ON "messages"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

-- Historico de status e append-only, como a trilha de auditoria: sem politica
-- de UPDATE ou DELETE, o Postgres recusa alteracao.
ALTER TABLE "message_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_status_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_status_events_tenant_select" ON "message_status_events"
  FOR SELECT USING ("organization_id" = current_org_id());--> statement-breakpoint
CREATE POLICY "message_status_events_tenant_insert" ON "message_status_events"
  FOR INSERT WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

ALTER TABLE "event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "event_outbox_tenant_isolation" ON "event_outbox"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
