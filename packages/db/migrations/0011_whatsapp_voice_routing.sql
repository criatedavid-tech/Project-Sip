-- A entrega de eventos de voz informa o número da conta, não o identificador
-- usado pelo webhook de mensagens. A view continua expondo apenas os campos
-- mínimos necessários para descobrir o tenant antes de ativar o RLS.
CREATE OR REPLACE VIEW whatsapp_routing AS
  SELECT phone_number_id, organization_id, id AS whatsapp_account_id, phone_number
  FROM whatsapp_accounts
  WHERE deactivated_at IS NULL;--> statement-breakpoint

ALTER VIEW whatsapp_routing SET (security_invoker = false);--> statement-breakpoint

GRANT SELECT ON whatsapp_routing TO PUBLIC;
