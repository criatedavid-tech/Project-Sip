#!/bin/sh
set -eu

required_vars="
SIP_TRUNK_HOST
SIP_USERNAME
SIP_PASSWORD
WAVOIP_SIP_HOST
WAVOIP_SIP_USERNAME
WAVOIP_SIP_PASSWORD
WAVOIP_CALLER_ID
TWILIO_SIP_DOMAIN
TWILIO_CALLER_ID
NVOIP_SIP_HOST
NVOIP_SIP_USERNAME
NVOIP_SIP_PASSWORD
ASTERISK_ARI_USERNAME
ASTERISK_ARI_PASSWORD
ASTERISK_WEBRTC_1001_PASSWORD
ASTERISK_WEBRTC_1002_PASSWORD
"

for variable in $required_vars; do
  eval "value=\${$variable:-}"
  if [ -z "$value" ]; then
    echo "variavel obrigatoria ausente: $variable" >&2
    exit 1
  fi
done

export SIP_SUPPORTED_CODECS="${SIP_SUPPORTED_CODECS:-alaw,ulaw}"
export SIP_PHONE_NUMBER="${SIP_PHONE_NUMBER:-${SIP_USERNAME}}"
export WAVOIP_SIP_PORT="${WAVOIP_SIP_PORT:-5060}"
export WAVOIP_SUPPORTED_CODECS="${WAVOIP_SUPPORTED_CODECS:-alaw,ulaw}"
export TWILIO_SUPPORTED_CODECS="${TWILIO_SUPPORTED_CODECS:-ulaw,alaw}"
export NVOIP_SIP_PORT="${NVOIP_SIP_PORT:-5060}"
export NVOIP_CALLER_ID="${NVOIP_CALLER_ID:-${NVOIP_SIP_USERNAME}}"
export NVOIP_SUPPORTED_CODECS="${NVOIP_SUPPORTED_CODECS:-alaw,ulaw}"
export ASTERISK_ARI_APP="${ASTERISK_ARI_APP:-omnichannel}"
export ASTERISK_RTP_START="${ASTERISK_RTP_START:-10000}"
export ASTERISK_RTP_END="${ASTERISK_RTP_END:-10099}"
export ASTERISK_STUN_ADDRESS="${ASTERISK_STUN_ADDRESS:-stun.l.google.com:19302}"
export ASTERISK_EXTENSION_START="${ASTERISK_EXTENSION_START:-1001}"
export ASTERISK_EXTENSION_END="${ASTERISK_EXTENSION_END:-1099}"
export ASTERISK_QUEUE_NAME="${ASTERISK_QUEUE_NAME:-vendas}"
export ASTERISK_QUEUE_STRATEGY="${ASTERISK_QUEUE_STRATEGY:-rrmemory}"
export ASTERISK_QUEUE_MEMBER_TIMEOUT="${ASTERISK_QUEUE_MEMBER_TIMEOUT:-20}"
export ASTERISK_QUEUE_RETRY="${ASTERISK_QUEUE_RETRY:-3}"
export ASTERISK_QUEUE_WRAPUP="${ASTERISK_QUEUE_WRAPUP:-5}"
export ASTERISK_QUEUE_MAX_WAIT="${ASTERISK_QUEUE_MAX_WAIT:-45}"

case "$ASTERISK_EXTENSION_START:$ASTERISK_EXTENSION_END" in
  *[!0-9:]*|:*) echo "faixa de ramais invalida" >&2; exit 1 ;;
esac
if [ "$ASTERISK_EXTENSION_START" -gt "$ASTERISK_EXTENSION_END" ]; then
  echo "faixa de ramais invalida" >&2
  exit 1
fi
case "$ASTERISK_QUEUE_NAME" in
  ''|*[!A-Za-z0-9_-]*) echo "nome de fila invalido" >&2; exit 1 ;;
esac
case "$ASTERISK_QUEUE_STRATEGY" in
  ringall|leastrecent|fewestcalls|random|rrmemory|linear|wrandom) ;;
  *) echo "estrategia de fila invalida" >&2; exit 1 ;;
esac
for numeric_value in \
  "$ASTERISK_QUEUE_MEMBER_TIMEOUT" \
  "$ASTERISK_QUEUE_RETRY" \
  "$ASTERISK_QUEUE_WRAPUP" \
  "$ASTERISK_QUEUE_MAX_WAIT"; do
  case "$numeric_value" in
    ''|*[!0-9]*) echo "parametro numerico da fila invalido" >&2; exit 1 ;;
  esac
done

render() {
  source_file="/opt/omni-asterisk/config/$1.template"
  target_file="/etc/asterisk/$1"
  envsubst < "$source_file" > "$target_file"
  chown asterisk:asterisk "$target_file"
  chmod 0600 "$target_file"
}

render ari.conf
render pjsip.conf
render queues.conf
render rtp.conf

webrtc_master_secret="${ASTERISK_WEBRTC_SECRET:-${ASTERISK_WEBRTC_1001_PASSWORD}:${ASTERISK_WEBRTC_1002_PASSWORD}}"
extension="$ASTERISK_EXTENSION_START"
while [ "$extension" -le "$ASTERISK_EXTENSION_END" ]; do
  case "$extension" in
    1001) extension_password="$ASTERISK_WEBRTC_1001_PASSWORD" ;;
    1002) extension_password="$ASTERISK_WEBRTC_1002_PASSWORD" ;;
    *)
      extension_password="$(
        printf 'omni-webrtc:%s' "$extension" \
          | openssl dgst -sha256 -hmac "$webrtc_master_secret" -binary \
          | openssl base64 -A \
          | tr '+/' '-_' \
          | tr -d '='
      )"
      ;;
  esac

  cat >> /etc/asterisk/pjsip.conf <<EOF

[$extension-auth]
type = auth
auth_type = userpass
username = $extension
password = $extension_password

[$extension]
type = aor
max_contacts = 1
remove_existing = yes
; O navegador WebRTC mantem o transporte WebSocket ativo. O qualify por SIP
; OPTIONS pode marcar clientes SIP.js registrados como indisponiveis, gerando
; um falso "Offline" no ARI. Zero preserva o estado pelo registro do contato.
qualify_frequency = 0

[$extension]
type = endpoint
transport = transport-ws
context = from-internal
disallow = all
allow = opus,ulaw,alaw
aors = $extension
auth = $extension-auth
webrtc = yes
direct_media = no
force_rport = yes
rewrite_contact = yes
rtp_symmetric = yes
rtp_keepalive = 20
dtmf_mode = rfc4733
EOF
  printf 'member => PJSIP/%s,%s\n' "$extension" "$extension" >> /etc/asterisk/queues.conf
  extension=$((extension + 1))
done

chown asterisk:asterisk /etc/asterisk/pjsip.conf /etc/asterisk/queues.conf
chmod 0600 /etc/asterisk/pjsip.conf /etc/asterisk/queues.conf

# Endereço externo só é necessário para mídia através de NAT. Em branco, o
# registro SIP ainda pode ser validado sem inventar o IP público da máquina.
if [ -z "${ASTERISK_EXTERNAL_ADDRESS:-}" ]; then
  sed -i '/^external_signaling_address=$/d; /^external_media_address=$/d' \
    /etc/asterisk/pjsip.conf
fi

envsubst '${ASTERISK_QUEUE_NAME} ${ASTERISK_QUEUE_MAX_WAIT} ${SIP_USERNAME} ${SIP_PHONE_NUMBER} ${TWILIO_CALLER_ID}' \
  < /opt/omni-asterisk/config/extensions.conf \
  > /etc/asterisk/extensions.conf
chown asterisk:asterisk /etc/asterisk/extensions.conf
chmod 0640 /etc/asterisk/extensions.conf

for config_file in http.conf logger.conf modules.conf; do
  cp "/opt/omni-asterisk/config/$config_file" "/etc/asterisk/$config_file"
  chown asterisk:asterisk "/etc/asterisk/$config_file"
  chmod 0640 "/etc/asterisk/$config_file"
done

mkdir -p /var/spool/asterisk/monitor /var/spool/asterisk/recording
chown -R asterisk:asterisk /var/spool/asterisk

exec "$@"
