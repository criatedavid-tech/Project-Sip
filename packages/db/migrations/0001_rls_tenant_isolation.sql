-- Isolamento multi-tenant no proprio banco.
--
-- A aplicacao define app.current_org_id por transacao (ver withOrganization em
-- src/client.ts). As politicas abaixo garantem que, mesmo que uma query esqueca
-- o filtro por organization_id, o Postgres nao devolve dado de outro tenant.
--
-- Importante: o dono da tabela ignora RLS por padrao. A role usada pela
-- aplicacao NAO pode ser superuser nem dona das tabelas, ou as politicas nao
-- surtem efeito. FORCE ROW LEVEL SECURITY fecha tambem o caso do dono.

--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Retorna NULL quando a variavel nao esta definida, fazendo a comparacao falhar
-- e nao devolver linha alguma. Sem isso, uma sessao sem tenant definido geraria
-- erro de cast e poderia ser confundida com falha de infraestrutura.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$$;--> statement-breakpoint

CREATE POLICY "organizations_tenant_isolation" ON "organizations"
  USING ("id" = current_org_id())
  WITH CHECK ("id" = current_org_id());--> statement-breakpoint

CREATE POLICY "organization_users_tenant_isolation" ON "organization_users"
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());--> statement-breakpoint

-- Trilha de auditoria e append-only: sem politica de UPDATE ou DELETE, essas
-- operacoes ficam bloqueadas mesmo para quem enxerga a organizacao.
CREATE POLICY "audit_logs_tenant_select" ON "audit_logs"
  FOR SELECT USING ("organization_id" = current_org_id());--> statement-breakpoint

CREATE POLICY "audit_logs_tenant_insert" ON "audit_logs"
  FOR INSERT WITH CHECK ("organization_id" = current_org_id());
