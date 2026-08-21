# Voz pelo WhatsApp no ambiente local

## O que foi integrado

O discador continua usando o ramal WebRTC e o tronco SIP já existente. A API
também recebe eventos do provedor de voz para auditar chamadas, detectar o
estado do dispositivo e avisar quando a conta estiver temporariamente limitada
a contatos conhecidos.

O endpoint é:

```text
POST /webhooks/whatsapp/voice?token={{token_aleatorio}}
```

As entregas são deduplicadas pelo identificador enviado no cabeçalho do
provedor e armazenadas em `webhook_deliveries`. O endpoint sempre responde 200
rapidamente para evitar retentativas em cascata; token ou payload inválidos
ficam registrados como rejeitados.

## Configuração local

Defina em `.env`:

```dotenv
WHATSAPP_VOICE_WEBHOOK_TOKEN={{segredo_com_32_ou_mais_caracteres}}
WHATSAPP_VOICE_ORGANIZATION_ID=
```

O segundo campo é opcional. Sem ele, a API identifica a organização pelo número
da conta cadastrado em `whatsapp_accounts` e conserva o vínculo da sessão para
eventos posteriores que não carregam número. Use o ID explícito apenas em um
ambiente local de organização única.

Como o sistema roda somente na máquina local, o provedor externo não alcança
`localhost`. Para testar eventos reais é necessário um túnel HTTPS temporário e
restrito apontando para a API local. Isso não é deploy da aplicação, mas expõe
um endpoint da máquina durante o teste; ative apenas quando necessário e encerre
o túnel depois.

## Métricas

O PABX agora envia ao worker os instantes reais de início, atendimento e fim da
chamada. O tempo até atendimento passa a ser calculado a partir desses horários.
O tempo de pós-atendimento continua como `Não disponível`, pois ainda não existe
um evento confiável de fim do pós-atendimento.

Os eventos do provedor não criam chamadas sintéticas nem substituem o histórico
do PABX. Eles servem como auditoria e monitoramento da conta, evitando duplicar
ligações ou inventar horários que o provedor não informa.
