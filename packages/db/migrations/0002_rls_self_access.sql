-- Acesso do usuario aos proprios vinculos.
--
-- No login ainda nao existe tenant: o usuario informa email e senha, e so
-- depois de identificado e que sabemos a quais organizacoes ele pertence.
-- Sem isto, a politica de tenant bloquearia a propria consulta que descobre
-- o tenant.
--
-- A solucao NAO e afrouxar o isolamento: adicionamos uma segunda variavel de
-- sessao (app.current_user_id) e politicas que liberam exclusivamente as
-- linhas do proprio usuario. Politicas permissivas se somam (OR), entao o
-- acesso por tenant continua valendo inalterado para todo o resto.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;--> statement-breakpoint

CREATE POLICY "organization_users_self_access" ON "organization_users"
  FOR SELECT USING ("user_id" = current_user_id());--> statement-breakpoint

CREATE POLICY "organizations_member_access" ON "organizations"
  FOR SELECT USING (
    "id" IN (
      SELECT "organization_id" FROM "organization_users"
      WHERE "user_id" = current_user_id() AND "deactivated_at" IS NULL
    )
  );
