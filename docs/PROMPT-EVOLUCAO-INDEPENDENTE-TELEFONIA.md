# Prompt mestre — evolução independente da telefonia

Use este documento como prompt de continuidade para uma IA de desenvolvimento.
Execute o trabalho em entregas pequenas, revisáveis e separadas. Não implemente
todas as frentes em uma única alteração.

## Papel

Você é responsável por evoluir a telefonia da Omni Platform preservando o
produto, os dados e as regras de negócio dentro do próprio projeto. Uma
plataforma externa pode ser usada somente como infraestrutura telefônica
substituível, nunca como núcleo do sistema.

## Contexto atual

O projeto já possui:

- autenticação com access token, refresh token, perfis e permissões;
- isolamento por organização com Row Level Security;
- restrição do atendente aos próprios registros e ao próprio ramal;
- caixa de entrada e atendimento pelo WhatsApp;
- discador WebRTC com DTMF, mudo e espera;
- chamadas por troncos SIP configurados no Asterisk;
- histórico de chamadas, gravações protegidas e transcrições;
- dashboard administrativo com filtros, cards, série temporal, tabela e CSV;
- campanhas progressivas com distribuição de um contato por vez;
- webhooks idempotentes e processamento assíncrono;
- execução e validação exclusivamente locais.

A API da plataforma externa oferece recursos de PABX e call center, incluindo
originação, CDR, chamadas ativas, troncos, DIDs, ramais, campanhas, mailings,
URA, jornada de operadores e SMS. O objetivo não é reproduzir a arquitetura
externa nem transferir para ela as regras do Omni.

## Objetivo principal

Tornar o Omni mais completo e independente, usando o mínimo possível da
plataforma externa. O sistema deve continuar funcionando com outros provedores
por meio de adaptadores equivalentes.

## Princípios obrigatórios

1. Não acoplar telas, regras de negócio ou banco a nomes de fornecedores.
2. Não enviar credenciais em query string.
3. Nunca devolver senhas SIP ou tokens ao navegador.
4. Não inventar métricas nem estimar tempos ausentes.
5. Manter usuários, permissões, contatos, campanhas, métricas e auditoria no Omni.
6. Preservar o isolamento por organização e o escopo próprio do atendente.
7. Implementar mudanças de banco por migrações incrementais e reversíveis.
8. Reaproveitar serviços, contratos, filas, componentes e modelos existentes.
9. Não remover integrações SIP atuais para introduzir um novo adaptador.
10. Trabalhar somente no ambiente local até existir autorização explícita para
    publicação.

## Dependência externa máxima permitida

Criar um adaptador opcional que utilize somente os recursos necessários para:

1. originar uma chamada;
2. consultar o histórico/CDR;
3. consultar chamadas ativas;
4. encerrar uma chamada ativa;
5. obter uma gravação externa apenas como contingência, se o contrato permitir.

Não usar como fonte de verdade os módulos externos de:

- pessoas e permissões;
- jornada e pausas;
- campanhas e templates;
- mailing e ocorrências;
- SMS;
- URA e fluxos;
- relatórios e dashboards;
- regras internas de negócio.

## Frente 1 — contrato de provedores

Criar ou consolidar um contrato interno de telefonia com operações equivalentes
a:

- `originateCall`;
- `getCall`;
- `listCalls`;
- `listActiveCalls`;
- `hangupCall`;
- `getRecording`, quando disponível;
- `health`.

Cada adaptador deve traduzir estados, códigos e payloads externos para modelos
internos. O restante da aplicação deve conhecer apenas o contrato interno.

Persistir:

- identificador interno da chamada;
- identificador externo;
- provedor utilizado;
- payload normalizado necessário;
- código SIP original;
- motivo e origem do desligamento;
- instante da última sincronização;
- estado e quantidade de retentativas da sincronização.

## Frente 2 — sincronização confiável

Como a API externa analisada não documenta webhooks de chamada, implementar uma
estratégia de polling controlado:

- frequência maior apenas durante chamadas ativas;
- sincronização incremental do CDR;
- janela de reconciliação para eventos atrasados;
- idempotência por organização, provedor e identificador externo;
- retentativas com backoff e limite;
- fila de erros e reprocessamento manual;
- alerta para divergência entre chamada externa e registro interno.

Não criar chamadas sintéticas quando não houver correlação segura.

## Frente 3 — estados e chamadas ativas

Normalizar os estados internos:

- `queued`;
- `originating`;
- `ringing`;
- `answered`;
- `completed`;
- `busy`;
- `no_answer`;
- `failed`;
- `cancelled`.

Preservar também o estado bruto recebido do provedor.

Adicionar uma visão de chamadas em andamento com:

- origem e destino;
- contato;
- colaborador e ramal;
- provedor;
- estado e duração atual;
- atualização automática;
- ação administrativa para encerrar;
- ação do atendente limitada à própria chamada.

Toda ação de encerramento deve ser auditada.

## Frente 4 — tempos reais e pós-atendimento

Evoluir o modelo para registrar, somente quando houver eventos confiáveis:

- `attempt_started_at`;
- `ringing_started_at`;
- `answered_at`;
- `ended_at`;
- `wrap_up_started_at`;
- `wrap_up_ended_at`;
- `queue_wait_seconds`;
- `ring_seconds`;
- `talk_seconds`;
- `wrap_up_seconds`.

Após o desligamento, abrir o pós-atendimento no Omni:

- solicitar a classificação da chamada;
- permitir observações;
- registrar contato correto, conversão e retorno agendado;
- impedir a retirada de um novo contato enquanto o pós-atendimento obrigatório
  estiver pendente;
- registrar `wrap_up_ended_at` somente quando o atendente concluir ou dispensar
  explicitamente a etapa.

Quando um campo não existir, retornar `null` e exibir `Não disponível`.

## Frente 5 — classificações e dashboard

Permitir classificações configuráveis por organização, incluindo inicialmente:

- venda;
- retorno agendado;
- contato correto;
- número inválido;
- ocupado;
- não atendeu;
- caixa postal;
- sem interesse;
- falha técnica.

Adicionar ao dashboard, apenas quando houver dados reais:

- taxa de atendimento;
- taxa de contato;
- taxa de conversão;
- abandono;
- ocupação por atendente;
- tempo em fila;
- tempo de toque;
- tempo de pós-atendimento;
- códigos SIP e motivos de desligamento;
- comparativo entre períodos;
- chamadas simultâneas;
- distribuição por hora;
- exportação XLSX, caso possa ser feita sem aumentar significativamente a
  complexidade.

Preservar os filtros, a exportação CSV e a separação entre entrada e saída.

## Frente 6 — campanhas, contatos e jornada próprios

Evoluir as campanhas do Omni sem depender do módulo externo:

- importação CSV com pré-visualização;
- deduplicação e normalização de telefones;
- lista de bloqueio e consentimento;
- retorno agendado;
- máximo de tentativas e intervalo entre tentativas;
- horários permitidos;
- distribuição automática;
- modos preview e progressivo;
- campos personalizados;
- histórico completo por contato;
- arquivamento sem excluir o histórico.

Implementar jornada operacional interna:

- início e fim de jornada;
- pausas configuráveis e respectivos motivos;
- estado disponível, ocupado, em pausa e em pós-atendimento;
- tempo acumulado por estado;
- histórico auditável.

## Frente 7 — discador e roteamento

O navegador deve chamar sempre a API interna do Omni. O backend escolhe o
adaptador e nunca entrega credenciais externas ao cliente.

Evoluir o discador com:

- retorno agendado;
- transferência cega e assistida;
- conferência com terceiro;
- seleção autorizada do número de saída;
- histórico recente e rediscagem;
- indicador de qualidade do áudio;
- mensagens amigáveis para códigos SIP;
- recuperação após atualização da página ou perda de conexão;
- fallback controlado entre provedores.

Criar regras internas simples de roteamento:

- canal preferencial;
- prefixo por país ou região;
- limite de chamadas simultâneas;
- fallback em caso de falha;
- horário permitido;
- seleção do identificador de chamada.

Manter os detalhes SIP no Asterisk ou dentro do adaptador do provedor.

## Frente 8 — gravações, transcrições e análise

Manter as gravações sob controle do Omni:

- copiar gravações externas para storage próprio quando permitido;
- verificar formato, integridade e duração;
- usar URLs externas temporárias, nunca como autorização permanente;
- definir retenção e descarte;
- registrar reprodução, download e exportação;
- testar backup e restauração.

Evoluir a transcrição com:

- separação por falante;
- busca no texto;
- resumo;
- palavras-chave;
- motivo do contato;
- sentimento acompanhado de nível de confiança;
- sugestão de classificação sempre confirmada pelo atendente;
- alertas de qualidade e conformidade;
- retentativa e revisão manual.

## Frente 9 — segurança, auditoria e observabilidade

Segurança:

- armazenar segredos fora do banco comum ou criptografados com chave externa;
- usar somente HTTPS com certificado válido;
- aplicar timeouts, limites de resposta e validação de payload;
- não registrar tokens, senhas, números completos ou áudios em logs;
- permitir rotação de credenciais sem indisponibilidade;
- impedir operações de gerenciamento de troncos até existir um desenho seguro
  para as credenciais SIP.

Auditoria:

- origem e encerramento de chamadas;
- reprodução, download e exportação;
- alterações em ramais e canais;
- mudanças em campanhas;
- início, pausa e fim de jornada;
- falhas e reprocessamentos de sincronização.

Observabilidade:

- saúde e latência de cada adaptador;
- erros por operação;
- falhas de autenticação;
- chamadas presas;
- divergência entre CDR e banco;
- canais simultâneos;
- filas de eventos e transcrição;
- uso de disco e storage.

## Ordem recomendada de entrega

1. Contrato interno de provedores e adaptador simulado para testes.
2. Migração dos novos campos de chamada e estados normalizados.
3. Adaptador externo somente para origem, consulta, chamadas ativas e hangup.
4. Sincronização idempotente e reconciliação de CDR.
5. Tela de chamadas ativas e auditoria.
6. Pós-atendimento e classificações configuráveis.
7. Novas métricas do dashboard.
8. Jornada e pausas.
9. Campanhas, mailing e roteamento próprios.
10. Gravações, análise, observabilidade e endurecimento de segurança.

## Procedimento obrigatório antes de alterar

1. Ler `AGENTS.md`, `RTK.md` e os documentos citados pelo README, quando
   existirem.
2. Executar `git status --short` e identificar a origem de toda mudança local.
3. Inspecionar esquema, migrações, contratos, serviços e endpoints existentes.
4. Confirmar que a branch local não está atrás do remoto.
5. Propor uma entrega pequena com critérios de aceitação verificáveis.
6. Preservar qualquer alteração que não pertença à entrega.

## Validação mínima de cada entrega

- testes unitários dos mapeamentos e regras;
- testes de idempotência e isolamento por organização;
- teste de atendente restrito aos próprios dados;
- teste de falha, timeout e retentativa do adaptador;
- lint;
- typecheck;
- testes relevantes;
- build completo;
- validação visual responsiva quando houver interface;
- documentação dos campos ou integrações ainda indisponíveis.

Não faça chamadas reais, não gere custos, não use dados de clientes, não faça
deploy, commit ou push sem autorização explícita.

## Entregável esperado de cada sessão

Ao concluir, informar:

- arquivos modificados;
- comportamento implementado;
- migrações e impactos no banco;
- testes executados e resultados;
- limitações e campos ainda indisponíveis;
- dependência externa introduzida;
- riscos e próxima entrega recomendada.

## Definição de sucesso

O Omni continua sendo a fonte de verdade e conserva toda a experiência do
produto. A plataforma externa pode ser removida ou substituída pela troca de um
adaptador, sem perder usuários, contatos, campanhas, métricas, gravações,
transcrições, auditoria ou regras de acesso.
