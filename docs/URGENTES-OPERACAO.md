# Pendências urgentes de operação

## Estado vigente

O projeto está somente no ambiente local. Não existe VPS, aplicação pública ou
infraestrutura em nuvem ativa. A versão do repositório e o banco local são a
fonte de verdade.

Não faça deploy, não crie recursos pagos e não exponha portas locais sem nova
autorização explícita.

## 1. Validar chamadas reais

Executar novos testes controlados para cada canal configurado:

1. chamada de saída;
2. chamada recebida e encaminhada para a fila;
3. áudio bidirecional;
4. atribuição ao colaborador e ramal corretos;
5. duração e tempo até atendimento;
6. gravação reproduzível;
7. transcrição concluída;
8. encerramento sem canais presos.

Não use números de clientes nos testes. Utilize contatos de homologação
autorizados e confirme eventuais custos antes da ligação.

## 2. Eventos de voz pelo WhatsApp

Para validar eventos reais:

1. definir `WHATSAPP_VOICE_WEBHOOK_TOKEN` com 32 ou mais caracteres aleatórios;
2. confirmar o número da conta em `whatsapp_accounts` ou definir, apenas no
   ambiente local de organização única, `WHATSAPP_VOICE_ORGANIZATION_ID`;
3. abrir um túnel HTTPS temporário e restrito para a API local;
4. cadastrar a URL `/webhooks/whatsapp/voice?token={{token}}` no provedor;
5. testar conexão, restrição temporária, chamada e gravação;
6. encerrar o túnel imediatamente após o teste.

O webhook não cria chamadas sintéticas. Eventos sem correspondência segura
ficam apenas na auditoria.

## 3. Métricas ainda incompletas

O Asterisk registra início, atendimento e encerramento. Ainda falta persistir o
fim do pós-atendimento. Até existir um evento confiável, `wrap_up_time` e o
tempo médio de atendimento dependente desse campo permanecem como
`Não disponível`.

Não preencher esses valores com zero nem estimar a partir da duração da chamada.

## 4. Gravações e privacidade

Antes de uso diário com dados reais:

- migrar os arquivos para storage em objeto;
- definir retenção e descarte;
- registrar reprodução, download e exportação;
- documentar base legal, finalidade e consentimento;
- testar restauração de backup;
- impedir acesso direto aos arquivos fora da API autenticada.

## 5. Segurança operacional

- preservar Row Level Security e o escopo próprio do atendente;
- manter banco, cache, storage, ARI e transcrição fora da internet pública;
- nunca versionar `.env`, tokens, senhas, áudios ou dados pessoais;
- trocar credenciais antes de qualquer futura publicação;
- validar logs para evitar telefone, token ou payload sensível;
- adicionar monitoramento de disco, filas, troncos e transcrições.

## 6. Antes de uma futura publicação

Uma publicação só pode começar depois de autorização explícita e deve incluir:

1. orçamento aprovado;
2. arquitetura e superfície de rede revisadas;
3. backup e restauração testados;
4. segredos gerenciados fora do repositório;
5. HTTPS/WSS e firewall restritivo;
6. testes de entrada, saída e concorrência;
7. plano de reversão e encerramento de custos.
