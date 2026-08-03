FROM alpine:3.23

RUN apk add --no-cache \
      asterisk~20 \
      asterisk-opus~20 \
      asterisk-sample-config~20 \
      asterisk-sounds-en~20 \
      asterisk-srtp~20 \
      ca-certificates \
      gettext-envsubst \
      openssl \
      tini \
    && mkdir -p \
      /var/lib/asterisk \
      /var/log/asterisk \
      /var/run/asterisk \
      /var/spool/asterisk/monitor \
      /var/spool/asterisk/recording \
    && chown -R asterisk:asterisk \
      /var/lib/asterisk \
      /var/log/asterisk \
      /var/run/asterisk \
      /var/spool/asterisk

COPY config/ /opt/omni-asterisk/config/
COPY entrypoint.sh /usr/local/bin/omni-asterisk-entrypoint

RUN sed -i 's/\r$//' /usr/local/bin/omni-asterisk-entrypoint \
    && chmod 0755 /usr/local/bin/omni-asterisk-entrypoint

EXPOSE 5060/udp 8088/tcp 10000-10099/udp

HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD asterisk -rx "core show uptime" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/omni-asterisk-entrypoint"]
CMD ["asterisk", "-f", "-vvv"]
