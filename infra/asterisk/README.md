# Asterisk local

Base da Fase 3 para validar dois ramais WebRTC, o tronco DirectCall e gravação
local. Credenciais reais nunca ficam nesta pasta: entram pelo `.env`, que é
ignorado pelo Git, e os arquivos finais são gerados dentro do container.

## Subir e validar

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up -d --build asterisk
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show registrations"
docker compose --env-file .env -f infra/docker-compose.yml exec asterisk asterisk -rx "pjsip show endpoints"
```

Depois de compilar o monorepo, o monitor de eventos pode ser iniciado com:

```powershell
pnpm --filter @omni/telephony-worker build
node --env-file=.env apps/telephony-worker/dist/main.js
```

O `pnpm dev` da raiz também inicia o worker em modo watch. Mantenha apenas uma
instância por `ASTERISK_ARI_APP`; uma segunda conexão substitui a primeira no
Asterisk.

O ARI fica limitado ao host em `http://127.0.0.1:8088/ari`. O WebSocket SIP
local usa `ws://localhost:8088/ws`. Em produção, trocar por HTTPS/WSS com
certificado confiável.

As gravações da prova de conceito ficam no volume Docker
`asterisk_recordings`. Não há URL pública nem cópia automática para MinIO
ainda; isso pertence à Fase 4.

O dialplan publica `OmniRecordingStarted` e `OmniRecordingFinished` no ARI. O
worker assina esses eventos, reconecta automaticamente e produz logs
estruturados sem incluir senha ou número de telefone.

## Rede e segurança

- SIP DirectCall: UDP 5060.
- RTP da PoC: UDP 10000–10099.
- Discagem externa aceita apenas números brasileiros no formato `55...`.
- Chamadas recebidas são identificadas somente pelos IPs publicados pela
  DirectCall.
- Para áudio através de NAT, configure `ASTERISK_EXTERNAL_ADDRESS` com o IPv4
  público e valide encaminhamento/firewall. Não invente esse valor.
- Desabilite SIP ALG no roteador se houver registro instável ou áudio unilateral.
