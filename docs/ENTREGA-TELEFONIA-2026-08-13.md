# Entrega de telefonia — 13/08/2026

## Visão geral

Esta entrega consolida a operação de telefonia da Omni Platform em três áreas:

- dashboard administrativo de métricas, histórico, gravações e transcrições;
- discador WebRTC manual e campanhas progressivas;
- configuração dos provedores SIP DirectCall, Nvoip, Twilio e WaVoIP.

O trabalho foi desenvolvido e validado somente no ambiente local. O envio ao
Git não publica a aplicação na VPS nem altera serviços de produção.

## Dashboard administrativo

O dashboard está disponível em `/telefonia/admin` e reutiliza os registros reais
de `voice_calls`, `call_recordings`, `call_transcriptions`, usuários, ramais e
contatos da organização.

### Métricas

- total de ligações;
- tempo total de conversação;
- tempo médio de conversação;
- ligações concluídas;
- ligações com falha;
- tempo médio de atendimento, exibido como `Não disponível` enquanto o fim do
  pós-atendimento não for persistido.

As falhas agregam os estados `failed`, `busy`, `no_answer` e `cancelled`. Os
tempos de conversação são calculados somente para registros que possuem duração;
valores ausentes não são substituídos por zero.

### Filtros e gráfico

O painel aceita período inclusivo, direção, colaborador, provedor, status e
granularidade. O período é interpretado no fuso `America/Sao_Paulo`, limitado a
366 dias, e pode ser limpo pela interface.

O gráfico agrupa a quantidade de chamadas por hora, dia, semana ou mês e separa
entrada e saída quando essas direções existem nos dados filtrados.

### Tabela e exportação

A tabela detalhada apresenta direção, contato/número, colaborador/ramal,
provedor, data e horário, conversação, espera até o atendimento,
pós-atendimento, status, gravação e transcrição. O resultado filtrado pode ser
exportado em CSV com BOM UTF-8 para compatibilidade com Excel. A exportação XLSX
não foi incluída porque o CSV atende ao requisito sem adicionar uma dependência
ao frontend.

A consulta retorna no máximo 100.000 chamadas e informa `truncated: true` quando
existirem mais resultados. Esse limite evita respostas administrativas sem
controle de tamanho.

### API e acesso

O endpoint `GET /telephony/admin/dashboard` exige simultaneamente as permissões
de leitura de chamadas, reprodução de gravações, leitura de transcrições e
gestão de usuários. Assim, administradores visualizam a organização, enquanto
atendentes não acessam o dashboard administrativo.

As consultas comuns de telefonia continuam aplicando o escopo do usuário:
atendentes recebem somente seus próprios registros, mesmo quando tentam informar
outro `userId`. O isolamento por organização permanece aplicado pelas políticas
RLS e pelo contexto transacional do banco.

## Campos temporais

O modelo atual de `voice_calls` já registra:

| Evento de negócio | Campo atual | Situação |
|---|---|---|
| Início da tentativa | `started_at` | Disponível |
| Momento do atendimento | `answered_at` | Disponível quando a chamada é atendida |
| Encerramento | `ended_at` | Disponível quando o evento de término é recebido |
| Fim do pós-atendimento | `wrap_up_ended_at` | Não existe |

O tempo até atendimento é derivado de `answered_at - started_at`. Para medir o
pós-atendimento de forma real, deve ser adicionada uma coluna temporal
`wrap_up_ended_at` e o frontend operacional precisa enviar ou provocar um evento
quando o atendente finalizar a tipificação. Só então poderão ser calculados:

- pós-atendimento: `wrap_up_ended_at - ended_at`;
- tempo médio de atendimento: conversação + pós-atendimento, conforme a regra
  de negócio adotada.

Até essa instrumentação existir, ambos são apresentados como `Não disponível`.

## Discador e campanhas

O discador está em `/telefonia/discador`. Ele oferece teclado, DTMF, mudo,
espera, encerramento, agenda de contatos e seleção do provedor suportado pela
interface. Campanhas progressivas permitem criar listas, ativar, pausar,
concluir, reservar atomicamente o próximo contato e registrar resultado e
observações.

A migração `0010_telephony_dialer.sql` cria `dialer_campaigns` e
`dialer_campaign_items`, com índices, vínculos à organização e políticas RLS.
Os detalhes de operação, permissões, endpoints e checklist estão em
[`DISCADOR.md`](DISCADOR.md).

## SIP e infraestrutura

A configuração do Asterisk passa a incluir o tronco autenticado da Nvoip, com
variáveis de ambiente documentadas e prefixo interno `*7`. O prefixo é removido
antes de enviar o número brasileiro ao provedor. Os segredos permanecem apenas
no `.env`; `.env.example` contém somente nomes e valores não sensíveis.

Também foram ajustados o dialplan, o template PJSIP, o entrypoint do Asterisk e
o Docker Compose principal. O compose reduzido
`infra/docker-compose.postgres.yml` e o script
`infra/scripts/validate-dialer-local.ps1` permitem validar migrações e RLS usando
somente PostgreSQL local, sem exigir provedores SIP ou acesso à VPS.

## Endpoints adicionados

- `GET /telephony/admin/dashboard`
- `GET /telephony/dialer/contacts`
- `POST /telephony/dialer/contacts`
- `GET /telephony/dialer/campaigns`
- `POST /telephony/dialer/campaigns`
- `PATCH /telephony/dialer/campaigns/:id/status`
- `POST /telephony/dialer/campaigns/:id/next`
- `PATCH /telephony/dialer/items/:id/result`

## Validação executada

Em 13/08/2026 foram executados localmente:

- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`, incluindo os testes de integração do banco com PostgreSQL local;
- `pnpm build`;
- validação visual em `http://localhost:3000`, em desktop e viewport móvel;
- filtros, gráfico, reprodução, transcrição e exportação CSV;
- acesso administrativo e bloqueio do endpoint para perfil de atendente;
- escopo próprio do atendente ao consultar chamadas.

Os dados artificiais criados para a validação visual foram removidos ao final.

## Pendências antes de produção

- criar e alimentar `wrap_up_ended_at` para medir pós-atendimento e TMA;
- validar registro, chamadas reais, áudio, gravação e transcrição da Nvoip;
- validar todos os provedores habilitados com destinos autorizados;
- executar testes concorrentes de reserva de itens de campanha;
- revisar a unicidade global de `telephony_extensions.endpoint_id`, pois a
  seleção automática de ramal ocorre dentro do escopo da organização;
- concluir os itens operacionais de gravação, retenção e auditoria descritos no
  README e em `docs/URGENTES-OPERACAO.md`;
- realizar backup e preparar um plano de reversão antes de qualquer deploy na
  VPS.
