# Pilha OCI de validacao do Project SIP

Esta configuracao cria a infraestrutura minima para migrar a homologacao para
recursos Oracle Always Free:

- 1 VM ARM `VM.Standard.A1.Flex`, marcada pela Oracle como Always Free elegible;
- 1 OCPU e 4 GB de memoria;
- imagem Ubuntu 24.04 ARM oficial mais recente compativel com a shape;
- volume de boot de 50 GB;
- uma VCN e uma sub-rede publica;
- um IPv4 publico efemero;
- HTTP/HTTPS, SIP da DirectCall e RTP;
- SSH restrito ao CIDR informado pelo administrador.

A pilha nao instala a aplicacao e nao cria banco gerenciado, load balancer,
backup ou volume adicional. API, ARI/WebSocket, PostgreSQL, Redis, MinIO e
Whisper devem permanecer internos aos containers e ser acessados externamente
apenas pelo proxy HTTPS quando aplicavel.

A criacao da A1 pode falhar com `Out of host capacity`. Isso significa falta
temporaria de capacidade na regiao e nao autoriza trocar silenciosamente para
uma shape paga. Tente novamente mais tarde. Confirme no resumo da OCI que a
shape continua marcada como Always Free e que o custo estimado e zero.

No OCI Resource Manager, `tenancy_ocid`, `compartment_ocid` e `region` sao
preenchidos automaticamente. Os valores manuais sao:

- `ssh_public_key`: conteudo do arquivo `.pub`;
- `admin_cidr`: IPv4 publico do administrador com `/32`.

Nunca envie ou cole a chave privada.
