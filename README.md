# Omni Platform

Plataforma interna de atendimento omnichannel com WhatsApp, telefonia SIP,
gravações e transcrição de chamadas.

## 1. Visão geral

O **Omni Platform** é uma aplicação interna para centralizar o atendimento por
WhatsApp e telefonia. O foco atual é permitir que vendedores e atendentes façam
e recebam chamadas por ramais individuais, enquanto supervisores e
administradores acompanham a operação, escutam gravações e consultam
transcrições.

Repositório: `criatedavid-tech/Project-Sip`

Diretório local utilizado no desenvolvimento:

```text
C:\Users\Criate\Documents\Codex\omni-platform
```

## 2. Estado atual

### Implementado

- Autenticação com perfis e permissões.
- Caixa de entrada para conversas do WhatsApp.
- Janela de atendimento de 24 horas da Meta.
- Painel de telefonia.
- Ramais WebRTC individuais no navegador.
- Ligações telefônicas por tronco SIP da DirectCall.
- Ligações telefônicas de saída por Twilio Elastic SIP Trunking.
- Estrutura SIP para chamadas de voz do WhatsApp via WaVoIP.
- Histórico de ligações com filtros por dia, colaborador, canal e status.
- Gravação automática das chamadas atendidas.
- Reprodução protegida das gravações pela API.
- Transcrição local com `faster-whisper`.
- Alternativa de transcrição pela OpenAI.
- Retentativas automáticas de transcrição.
- Painel administrativo diário.
- Cadastro, ativação e desativação de colaboradores.
- Atribuição automática de ramais.
- Separação de acesso entre administrador, supervisor e atendente.
- Isolamento de organizações no PostgreSQL com Row Level Security.

### Validado na VPS de homologação

- Registro do tronco DirectCall no Asterisk.
- Registro do tronco WaVoIP no Asterisk.
- Registro de ramais WebRTC individuais pelo navegador usando HTTPS/WSS.
- Ligações de saída reais pela DirectCall e pela WaVoIP.
- Ligações de saída, gravação e transcrição pela Twilio para destino verificado
  em conta Trial.
- Áudio bidirecional com terceiros após o ajuste de ICE/STUN e RTP simétrico.
- Persistência do histórico de chamadas.
- Captura de eventos do Asterisk pelo worker de telefonia.
- Gravação e processamento local de transcrição para chamadas telefônicas.
- Login, administração de colaboradores e atribuição dos ramais `1001` e `1002`.

### Pendente ou parcialmente validado

- Migrar a VPS de homologação, atualmente sustentada pelos créditos do Free
  Trial, para uma instância elegível ao Oracle Always Free antes do vencimento.
- Validar uma ligação recebida da DirectCall de ponta a ponta: fila, atendimento,
  áudio, gravação e transcrição.
- Revalidar gravação e transcrição de uma chamada WaVoIP atendida; chamadas
  canceladas ou não atendidas agora aparecem como `Sem gravação`, em vez de
  falso erro.
- Publicar na VPS e validar a correção que preserva o ramal de origem nas novas
  ligações Twilio. Registros antigos exibidos como `Não atribuída` não são
  corrigidos automaticamente.
- Armazenamento definitivo das gravações em objeto S3/MinIO.
- Política empresarial de retenção e descarte de áudio.
- Auditoria de cada reprodução ou download de gravação.
- Backup externo, monitoramento e testes de chamadas simultâneas.

O ambiente publicado é de homologação. Não deve ser tratado como produção até
que backup, retenção, monitoramento, segurança operacional e testes de entrada e
concorrência estejam concluídos.

O checklist de maior prioridade está em
[`docs/URGENTES-OPERACAO.md`](docs/URGENTES-OPERACAO.md).

## 3. Arquitetura

```mermaid
flowchart LR
    U[Atendente no navegador] -->|HTTPS / WebSocket| W[Next.js Web]
    W -->|REST + JWT| A[NestJS API]
    W -->|SIP WebRTC| PBX[Asterisk]
    A --> DB[(PostgreSQL)]
    A --> R[(Redis)]
    A --> M[Meta WhatsApp Cloud API]
    PBX --> DC[DirectCall SIP]
    PBX --> WV[WaVoIP SIP]
    PBX --> TWILIO[Twilio Elastic SIP Trunking]
    PBX -->|Eventos ARI| TW[Telephony Worker]
    TW --> DB
    TW -->|Arquivo WAV| WH[Whisper local]
    PBX --> FS[(Gravações locais)]
    TW --> FS
    A --> FS
    A -. evolução .-> S3[(MinIO / S3)]
```

### Componentes

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| `apps/web` | Next.js 15, React 19, SIP.js | Interface, sessão e telefone WebRTC |
| `apps/api` | NestJS 11 | Autenticação, conversas, telefonia e controle de acesso |
| `apps/telephony-worker` | Node.js, WebSocket ARI | Eventos de chamadas, gravações e transcrições |
| `packages/db` | Drizzle ORM, PostgreSQL | Schema, migrações e isolamento multiempresa |
| `packages/auth` | JWT, Argon2 | Senhas, tokens, perfis e permissões |
| `packages/config` | Zod | Validação das variáveis de ambiente |
| `packages/observability` | Logs estruturados | Logs com ocultação de dados sensíveis |
| `packages/provider-contracts` | TypeScript | Contratos para SIP, WhatsApp, storage e transcrição |
| `infra/asterisk` | Asterisk 20 | PBX, ramais, filas, troncos e gravação |
| `infra/whisper` | Python, faster-whisper | Transcrição local de áudio |
| `infra/docker-compose.yml` | Docker Compose | PostgreSQL, Redis, MinIO, Asterisk e Whisper |

## 4. Estrutura do repositório

```text
omni-platform/
├── apps/
│   ├── api/
│   ├── telephony-worker/
│   ├── web/
│   └── workers/
├── infra/
│   ├── asterisk/
│   ├── whisper/
│   └── docker-compose.yml
├── packages/
│   ├── auth/
│   ├── config/
│   ├── db/
│   ├── eslint-config/
│   ├── observability/
│   ├── provider-contracts/
│   ├── queue-kit/
│   ├── testing/
│   └── tsconfig/
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 5. Requisitos para desenvolvimento

- Windows 10 ou 11.
- Docker Desktop.
- Node.js 20 ou superior.
- pnpm 11.18 ou compatível.
- Git.
- Microfone e permissão de áudio no navegador.
- Credenciais de um provedor SIP para testes reais.

## 6. Instalação local

### 6.1 Instalar dependências

```powershell
cd C:\Users\Criate\Documents\Codex\omni-platform
pnpm install
```

### 6.2 Criar o arquivo de ambiente

```powershell
Copy-Item .env.example .env
```

Preencha o `.env` local. Nunca publique esse arquivo e nunca copie senhas para
documentação, issues ou commits.

As principais categorias são:

- API, Web e URLs locais.
- PostgreSQL e role restrita da aplicação.
- Redis.
- MinIO/S3.
- segredos JWT.
- Asterisk ARI e WebRTC.
- DirectCall.
- WaVoIP.
- Twilio Elastic SIP Trunking.
- Meta WhatsApp Cloud API.
- Whisper local ou OpenAI.

### 6.3 Subir a infraestrutura

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

### 6.4 Carregar o `.env` no PowerShell

Os comandos do banco leem variáveis do processo. No terminal de
desenvolvimento, carregue o arquivo sem imprimi-lo:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable(
      $matches[1].Trim(),
      $matches[2].Trim().Trim('"'),
      'Process'
    )
  }
}
```

### 6.5 Preparar o banco

```powershell
pnpm --filter @omni/db db:setup
```

Esse comando executa migrações, cria a role restrita usada pela aplicação e
sincroniza os perfis e permissões.

### 6.6 Criar a primeira organização e o administrador

```powershell
pnpm --filter @omni/db db:create-org "Minha Empresa" minha-empresa "Administrador" admin@empresa.com "uma-senha-temporaria-segura"
```

A senha precisa ter pelo menos 12 caracteres. Como o valor entra no histórico
do terminal, utilize uma senha temporária e faça a troca conforme a política da
empresa.

### 6.7 Iniciar a aplicação

```powershell
pnpm dev
```

## 7. Endereços locais

| Serviço | Endereço padrão |
|---|---|
| Aplicação Web | `http://localhost:3000` |
| API | `http://localhost:3001` |
| Saúde da API | `http://localhost:3001/health` |
| Prontidão da API | `http://localhost:3001/ready` |
| Asterisk ARI | `http://127.0.0.1:8088/ari` |
| Asterisk WebSocket | `ws://localhost:8088/ws` |
| Whisper | `http://127.0.0.1:8090` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

## 8. Telas do produto

| Rota | Função |
|---|---|
| `/login` | Autenticação |
| `/inbox` | Conversas e mensagens do WhatsApp |
| `/telefonia` | Estado dos troncos, ramal, equipe e discador |
| `/telefonia/ligacoes` | Histórico filtrado de ligações |
| `/telefonia/gravacoes` | Áudios e transcrições |
| `/telefonia/admin` | Gestão diária e colaboradores; somente administrador |

## 9. Perfis e visibilidade

### Administrador

- Visualiza toda a organização.
- Gerencia colaboradores e ramais.
- Consulta ligações, gravações e transcrições da equipe.
- Acessa o painel administrativo.

### Supervisor

- Visualiza os resultados da equipe.
- Consulta ligações e transcrições.
- Escuta e pode baixar gravações conforme a permissão atribuída.
- Não cadastra usuários pelo painel administrativo atual.

### Atendente

- Faz e recebe chamadas pelo próprio ramal.
- Visualiza somente suas ligações.
- Escuta somente suas gravações.
- Visualiza somente suas transcrições.
- Não visualiza outros atendentes.

### Auditor

- Possui acesso de leitura aos dados autorizados.
- Não altera contatos, conversas, canais ou usuários.

O escopo do atendente é aplicado na API, não apenas escondido na interface.

## 10. Telefonia

### 10.1 Ramais

O intervalo padrão é de `1001` a `1099`, totalizando até 99 ramais cadastrados.
O limite real de chamadas simultâneas depende do contrato do provedor, da CPU,
da rede, dos codecs e do dimensionamento do Asterisk.

O administrador pode informar um ramal de quatro dígitos ou deixar a plataforma
selecionar automaticamente o próximo ramal livre.

### 10.2 Ligações de saída

1. O usuário autentica seu ramal SIP.js no Asterisk por WebSocket.
2. O navegador envia a chamada para o Asterisk.
3. O dialplan seleciona DirectCall, WaVoIP ou Twilio.
4. O Asterisk inicia a gravação quando a chamada é atendida.
5. Eventos personalizados são enviados pelo ARI.
6. O worker persiste a chamada e agenda a transcrição.

### 10.3 Ligações recebidas

1. O provedor envia o `INVITE` SIP ao Asterisk.
2. O Asterisk encaminha para a fila configurada, por padrão `vendas`.
3. A estratégia padrão é `rrmemory`.
4. O ramal que atende é associado ao colaborador correspondente.
5. O áudio é gravado e processado após o encerramento.

Para receber chamadas em uma máquina atrás de NAT, normalmente são necessários:

- IPv4 público ou VPS.
- UDP `5060` para sinalização SIP.
- UDP `10000–10099` para RTP.
- firewall restrito aos IPs do provedor sempre que possível.
- SIP ALG desabilitado quando causar registro instável ou áudio unilateral.

O ambiente atual hospeda o Asterisk em uma VPS com IPv4 público, HTTPS/WSS e
certificado válido. ICE/STUN, RTP simétrico e `rtp_keepalive` foram habilitados
para estabilizar o áudio WebRTC através de NAT. Redes corporativas mais
restritivas ainda podem exigir um servidor TURN.

### 10.4 Provedores

**DirectCall:** telefonia fixa e móvel por tronco SIP. O registro e as ligações
de saída foram validados na VPS. A entrada pelo DID ainda precisa de validação
completa.

**WaVoIP:** chamadas de voz do WhatsApp apresentadas ao Asterisk como um segundo
tronco SIP. As chamadas e o áudio ao vivo foram validados. Chamadas não
atendidas não devem ser tratadas como falha de gravação; ainda é necessária uma
revalidação final de uma chamada atendida com áudio e transcrição. É
independente da integração de mensagens da Meta.

**Twilio:** telefonia fixa e móvel por Elastic SIP Trunking. A integração atual
usa autenticação por IP ACL, não cria registro SIP e seleciona a rota com o
prefixo interno `*9`. O Asterisk envia o destino em E.164 com `+`, utiliza um
Caller ID verificado e preserva separadamente o ramal do navegador para atribuir
a chamada e a gravação ao colaborador correto. Em conta Trial, somente destinos
verificados podem ser chamados. O recebimento de chamadas exige um número
Twilio associado ao tronco e uma Origination URI.

**Meta WhatsApp Cloud API:** mensagens de texto e eventos do WhatsApp Business.
Não fornece ao Asterisk as chamadas de voz tradicionais do aplicativo.

## 11. Gravações e transcrições

O Asterisk utiliza `MixMonitor` para produzir arquivos WAV. Os arquivos ficam
em `infra/.local/asterisk-recordings` no ambiente atual.

O `telephony-worker` acompanha eventos ARI:

- `OmniRecordingStarted`;
- `OmniRecordingFinished`.

Após o término da chamada, o worker:

1. atualiza o histórico da chamada;
2. valida a existência do WAV;
3. registra os metadados da gravação;
4. envia o áudio ao provedor de transcrição;
5. grava texto, idioma, modelo e segmentos no PostgreSQL.

O provedor padrão é `whisper_local`, executado no próprio Docker. Também há
implementações `mock` e `openai`.

As transcrições com falha podem ser tentadas novamente automaticamente, com
espera progressiva, até cinco tentativas. A tela de gravações também oferece
uma ação manual de reprocessamento.

## 12. API principal

### Saúde

- `GET /health`
- `GET /ready`

### Autenticação

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

### Conversas

- `GET /conversations`
- `GET /conversations/:id/messages`
- `POST /conversations/:id/messages`
- `POST /conversations/:id/read`

### Telefonia

- `GET /telephony/overview`
- `GET /telephony/calls`
- `GET /telephony/recordings`
- `GET /telephony/webrtc-config`
- `GET /telephony/recordings/:id/audio`
- `POST /telephony/recordings/:id/retry-transcription`

Filtros disponíveis nas listas: `date`, `userId`, `provider` e `status`.

### Administração de telefonia

- `GET /telephony/admin/daily`
- `GET /telephony/admin/collaborators`
- `POST /telephony/admin/collaborators`
- `PATCH /telephony/admin/collaborators/:id/status`

### WhatsApp

- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`

## 13. Modelo de dados

As principais tabelas são:

- `organizations`: empresas ou unidades isoladas.
- `users`: usuários globais.
- `organization_users`: vínculo de usuário, organização e perfil.
- `roles`, `permissions`, `role_permissions`: autorização.
- `contacts`, `contact_channels`: clientes e canais.
- `conversations`, `messages`: caixa de entrada.
- `whatsapp_accounts`, `phone_numbers`: configurações de canais.
- `telephony_extensions`: ramais atribuídos.
- `voice_calls`: histórico normalizado de chamadas.
- `call_recordings`: metadados dos áudios.
- `call_transcriptions`: texto, segmentos e retentativas.
- `audit_logs`: estrutura de auditoria.
- `webhook_deliveries`, `event_outbox`: eventos e processamento confiável.

O áudio não é armazenado dentro do PostgreSQL.

## 14. Comandos de desenvolvimento

```powershell
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Comandos úteis da infraestrutura:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml ps
docker compose --env-file .env -f infra/docker-compose.yml logs -f asterisk
docker compose --env-file .env -f infra/docker-compose.yml logs -f whisper
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show registrations"
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show endpoints"
```

## 15. Portas de rede

| Porta | Protocolo | Serviço | Exposição recomendada |
|---|---|---|---|
| 3000 | TCP | Web | Local em desenvolvimento; HTTPS em produção |
| 3001 | TCP | API | Privada ou atrás de proxy HTTPS |
| 5060 | UDP | SIP | Somente provedor e regras específicas |
| 8088 | TCP | ARI/WebSocket | Local no desenvolvimento; proxy TLS em produção |
| 10000–10099 | UDP | RTP | Provedores e clientes de mídia necessários |
| 8090 | TCP | Whisper | Apenas localhost/rede privada |
| 5432 | TCP | PostgreSQL | Apenas rede privada |
| 6379 | TCP | Redis | Apenas rede privada |
| 9000/9001 | TCP | MinIO | Apenas rede privada/administração |

## 16. Segurança e privacidade

- Nunca versionar `.env`, senhas SIP, chaves da Meta ou segredos JWT.
- Trocar qualquer credencial compartilhada por captura de tela ou mensagem.
- Utilizar HTTPS e WSS em produção.
- Restringir ARI, banco, Redis, MinIO e Whisper à rede privada.
- Manter a role administrativa do banco separada da role da aplicação.
- Preservar as políticas RLS de todas as tabelas multiempresa.
- Registrar acesso a áudio e exportações antes do uso em produção.
- Definir retenção, descarte, consentimento e finalidade das gravações conforme
  a política interna e a LGPD.
- Não expor UDP `5060` para toda a internet quando for possível restringir aos
  endereços do provedor.
- Realizar backup criptografado do banco e das gravações.

## 17. Operação na VPS

O conjunto completo está implantado em uma VPS Oracle de homologação com IPv4
público, proxy HTTPS, WebSocket seguro e containers em rede privada. A máquina
atual não é permanente: utiliza créditos do Free Trial e precisa ser migrada
antes do fim da avaliação.

Antes do uso diário:

1. Migrar para uma shape explicitamente marcada como Always Free e confirmar
   custo estimado igual a zero antes da criação.
2. Expor somente HTTPS, SIP restrito aos provedores e o intervalo RTP necessário.
3. Manter API, ARI, PostgreSQL, Redis, MinIO e Whisper sem exposição pública.
4. Configurar backup externo e testar uma restauração.
5. Monitorar saúde, espaço em disco, registros SIP, filas e transcrições.
6. Testar entrada, saída, áudio, gravação e chamadas simultâneas.
7. Após alterar o dialplan, validar que uma nova chamada Twilio aparece com o
   colaborador e o ramal corretos; registros antigos não são retroativamente
   associados.

## 18. Diagnóstico rápido

### Tronco não registra

```powershell
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show registrations"
```

Verifique host, usuário, senha, DNS, horário da máquina e firewall.

### Ramal aparece offline

```powershell
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show endpoints"
```

Verifique WebSocket, credencial do ramal, permissão do microfone e console do
navegador.

### Ligação recebida cai imediatamente

Ative temporariamente o logger SIP:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip set logger on"
docker compose --env-file .env -f infra/docker-compose.yml logs -f asterisk
```

Se nenhum pacote aparecer, investigue NAT, encaminhamento de UDP, CGNAT,
firewall e roteamento do DID no provedor.

### Existe chamada, mas não há áudio

Verifique o intervalo RTP, endereço externo do Asterisk, NAT, codecs e SIP ALG.

### Gravação não aparece

Verifique:

- logs do Asterisk;
- presença do WAV em `infra/.local/asterisk-recordings`;
- conexão ARI do `telephony-worker`;
- caminho `ASTERISK_RECORDINGS_PATH`;
- permissões do volume.

### Chamada Twilio aparece como `Não atribuída`

Confirme que a rota Twilio salva `CALLERID(num)` em `OMNI_ORIGIN_EXTENSION`
antes de substituir o Caller ID pelo número verificado. O quinto argumento de
`record-and-dial` deve usar `OMNI_ORIGIN_EXTENSION`. Depois de atualizar o
container Asterisk, faça uma nova chamada: o histórico antigo não é alterado.

### Transcrição falhou

```powershell
docker compose --env-file .env -f infra/docker-compose.yml logs -f whisper
```

Confirme modelo, memória disponível, tamanho do áudio e acesso ao endpoint
local. Depois use a ação de tentar novamente na tela de gravações.

## 19. Próximos passos

1. Migrar a VPS temporária para Oracle Always Free ou desligá-la antes de terminar
   o Free Trial.
2. Validar chamadas recebidas da DirectCall.
3. Publicar e validar a atribuição de colaborador nas novas chamadas Twilio.
4. Revalidar gravação e transcrição das chamadas WaVoIP atendidas.
5. Migrar gravações para armazenamento externo S3/MinIO.
6. Implementar auditoria de reprodução e download.
7. Definir retenção, consentimento e descarte das gravações.
8. Adicionar monitoramento, alertas e backup com restauração testada.
9. Criar testes end-to-end do navegador e de chamadas simultâneas.
10. Publicar um runbook de recuperação de incidentes.

## 20. Controle de versão

Os marcos funcionais, correções da telefonia e mudanças operacionais devem ser
registrados em commits separados para permitir auditoria e reversão segura.

O projeto é atualmente uma aplicação interna. Não há licença pública definida;
não assuma permissão de redistribuição sem autorização da empresa.
