# Pendencias urgentes de operacao

Este documento descreve as acoes que devem ser concluidas antes de considerar a
plataforma pronta para uso diario. Nao contem credenciais nem substitui backup.

## 1. Estado do ambiente

- A aplicacao esta publicada em uma VPS Oracle de homologacao.
- HTTPS, WSS, ramais WebRTC, DirectCall e WaVoIP estao operacionais.
- O audio bidirecional foi validado apos habilitar ICE/STUN, RTP simetrico e
  `rtp_keepalive`.
- A VPS atual usa uma shape sustentada pelos creditos do Free Trial e nao deve
  continuar ativa depois do fim da avaliacao.
- Chamadas telefonicas sao gravadas e transcritas.
- Chamadas WaVoIP ainda nao geram uma gravacao utilizavel.
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

A chamada WaVoIP ao vivo nao deve ser considerada completamente validada apenas
porque o historico mostra `Concluida`. O teste e aprovado somente quando o
`MixMonitor` gera um arquivo nao vazio, a API consegue reproduzi-lo e o worker
conclui a transcricao.

Verificar, nessa ordem:

1. canal real criado pelo dialplan WaVoIP;
2. inicio e encerramento do `MixMonitor`;
3. caminho e permissoes do volume de gravacoes;
4. evento ARI de gravacao concluida;
5. vinculacao entre `call_id` e arquivo;
6. envio do arquivo ao Whisper.

## 5. Backup minimo

O backup deve conter, de forma criptografada:

- dump consistente do PostgreSQL;
- volume ou objeto das gravacoes;
- lista de versoes e imagens dos containers;
- configuracoes sem segredos no Git;
- segredos em cofre ou arquivo protegido separado.

Uma copia nao e considerada backup ate que uma restauracao de teste seja
concluida em ambiente separado.
