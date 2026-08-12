# Pendencias urgentes de operacao

Este documento descreve as acoes que devem ser concluidas antes de considerar a
plataforma pronta para uso diario. Nao contem credenciais nem substitui backup.

## 1. Estado do ambiente

- A aplicacao esta publicada em uma VPS Oracle de homologacao.
- HTTPS, WSS, ramais WebRTC, DirectCall, WaVoIP e a saida Twilio estao
  operacionais.
- O audio bidirecional foi validado apos habilitar ICE/STUN, RTP simetrico e
  `rtp_keepalive`.
- A VPS atual usa uma shape sustentada pelos creditos do Free Trial e nao deve
  continuar ativa depois do fim da avaliacao.
- Chamadas telefonicas sao gravadas e transcritas.
- A chamada Twilio para destino verificado, a gravacao e a transcricao foram
  validadas. A correcao de atribuicao ao ramal ainda precisa ser publicada na
  VPS e validada com uma nova chamada.
- Tentativas canceladas ou nao atendidas aparecem como `Sem gravacao`, sem
  falso erro. Uma chamada WaVoIP atendida ainda precisa de revalidacao final do
  arquivo e da transcricao.
- A entrada pelo DID DirectCall ainda nao foi validada de ponta a ponta.

## 2. Migracao para Oracle Always Free

A fonte Terraform revisavel esta em `infra/oci-free-stack`. Ela solicita uma
`VM.Standard.A1.Flex` ARM com 1 OCPU e 4 GB. Nao substitua a shape por E5, A2 ou
outra opcao sem confirmar explicitamente custo zero.

Ordem segura de migracao:

1. Registrar a data de encerramento do Free Trial e criar um lembrete anterior.
2. Gerar backup do PostgreSQL, das gravacoes e dos arquivos de configuracao.
3. Criar a A1 mantendo a VPS atual ativa.
4. Instalar Docker e clonar o repositorio na nova instancia.
5. Transferir o `.env` por canal seguro, sem adiciona-lo ao Git.
6. Restaurar banco e gravacoes.
7. Subir os containers e validar saude, login, ramal, DirectCall e WaVoIP.
8. Validar audio, gravacao e transcricao com chamada real.
9. Trocar DNS e configuracoes dos provedores para o novo IPv4.
10. Manter a VPS antiga apenas durante a janela de retorno definida.
11. Depois da validacao e de um novo backup, encerrar a VPS antiga antes que
    ela possa gerar cobranca.

Se a OCI responder `Out of host capacity`, nao crie uma shape paga como
alternativa automatica. Preserve os backups e tente a A1 novamente depois.

## 3. Validacao de chamada recebida DirectCall

O teste somente e aprovado quando uma chamada externa percorre todo o fluxo:

1. O numero DirectCall recebe a chamada.
2. O `INVITE` chega ao Asterisk.
3. A fila `vendas` chama um ramal WebRTC.
4. O atendente atende e ambos os lados ouvem audio.
5. O colaborador correto aparece no historico.
6. O WAV e criado e pode ser reproduzido.
7. A transcricao termina sem intervencao manual.

Durante o teste, acompanhar o logger PJSIP, o console do Asterisk e os logs do
worker de telefonia. Nao publicar credenciais nos logs compartilhados.

## 4. Gravacao WaVoIP

A chamada WaVoIP foi validada com terceiros: o `MixMonitor` gerou arquivo nao
vazio, a API conseguiu reproduzi-lo e o worker enviou o audio ao Whisper. Uma
transcricao pode ficar vazia quando o arquivo nao contem fala detectavel.

Verificar, nessa ordem:

1. canal real criado pelo dialplan WaVoIP;
2. inicio e encerramento do `MixMonitor`;
3. caminho e permissoes do volume de gravacoes;
4. evento ARI de gravacao concluida;
5. vinculacao entre `call_id` e arquivo;
6. envio do arquivo ao Whisper.

## 5. Atribuicao das chamadas Twilio

A Twilio substitui o Caller ID SIP pelo numero verificado antes de enviar a
chamada externa. Sem preservar o valor anterior, o evento ARI recebe o telefone
externo no campo de ramal e a interface mostra `Nao atribuida`.

O dialplan corrigido executa estes passos:

1. salva o `CALLERID(num)` original em `OMNI_ORIGIN_EXTENSION`;
2. aplica `TWILIO_CALLER_ID` para a chamada externa;
3. envia `OMNI_ORIGIN_EXTENSION` ao subprograma `record-and-dial`;
4. o worker localiza o ramal em `telephony_extensions` e vincula usuario e
   organizacao.

Depois do deploy, fazer uma nova chamada Twilio e confirmar historico,
gravacao, transcricao, colaborador e ramal. Registros anteriores nao sao
reprocessados automaticamente. A conta Trial continua limitada a destinos
verificados; recebimento exige numero Twilio e Origination URI.

## 6. Backup minimo

O backup deve conter, de forma criptografada:

- dump consistente do PostgreSQL;
- volume ou objeto das gravacoes;
- lista de versoes e imagens dos containers;
- configuracoes sem segredos no Git;
- segredos em cofre ou arquivo protegido separado.

Uma copia nao e considerada backup ate que uma restauracao de teste seja
concluida em ambiente separado.

### Backup automatizado na VPS

O script `infra/scripts/backup.sh` gera um dump consistente do PostgreSQL e um
arquivo compactado das gravacoes. Tambem grava checksums SHA-256, restringe as
permissoes e remove copias locais com mais de 14 dias.

Instalacao na VPS:

```bash
sudo install -m 0755 infra/scripts/backup.sh /home/opc/project-sip/infra/scripts/backup.sh
sudo install -m 0644 infra/systemd/project-sip-backup.service /etc/systemd/system/
sudo install -m 0644 infra/systemd/project-sip-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now project-sip-backup.timer
sudo systemctl start project-sip-backup.service
sudo systemctl status project-sip-backup.service --no-pager
```

As copias ficam em `/var/backups/project-sip`, acessiveis apenas pelo `root`.
Para protecao contra perda da VPS, ainda e obrigatorio enviar periodicamente uma
copia criptografada para outro local e testar a restauracao.

## 7. Exposicao de servicos internos

PostgreSQL, Redis e MinIO devem ser publicados somente em `127.0.0.1`. O acesso
externo direto a esses servicos nao e necessario para a aplicacao e amplia a
superficie de ataque. A interface publica deve permanecer restrita ao proxy
HTTPS e as portas SIP/RTP estritamente necessarias.
