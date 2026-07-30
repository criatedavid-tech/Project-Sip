-- Roteamento de webhook: descobrir o tenant antes de ter tenant.
--
-- O webhook da Meta identifica o destino pelo phone_number_id. Para saber a
-- que organizacao ele pertence e preciso ler whatsapp_accounts — mas essa
-- tabela tem RLS por organizacao, e nesse instante ainda nao ha organizacao
-- fixada na sessao. A consulta nao retornaria linha alguma.
--
-- A saida NAO e dar conexao administrativa a aplicacao: isso anularia o RLS
-- de todo o banco caso a API fosse comprometida.
--
-- Em vez disso, uma view SECURITY DEFINER (padrao no Postgres: a view executa
-- com os privilegios de quem a criou) expoe exclusivamente o mapeamento
-- necessario para rotear — tres colunas, nenhum dado de conversa, mensagem ou
-- contato. A aplicacao recebe SELECT apenas nela.

--> statement-breakpoint
CREATE OR REPLACE VIEW whatsapp_routing AS
  SELECT phone_number_id, organization_id, id AS whatsapp_account_id
  FROM whatsapp_accounts
  WHERE deactivated_at IS NULL;--> statement-breakpoint

-- security_invoker = false e o padrao, mas declarar explicitamente evita que
-- uma mudanca de default do Postgres quebre o roteamento em silencio.
ALTER VIEW whatsapp_routing SET (security_invoker = false);--> statement-breakpoint

GRANT SELECT ON whatsapp_routing TO PUBLIC;
