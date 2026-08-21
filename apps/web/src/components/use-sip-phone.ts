"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type WebRtcConfig } from "@/lib/api-client";

export type SipPhoneStatus =
  | "connecting"
  | "ready"
  | "calling"
  | "incoming"
  | "active"
  | "offline"
  | "error";

export type VoiceProvider = "directcall" | "wavoip" | "twilio" | "nvoip";

interface SipClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  call(destination: string): Promise<void>;
  answer(): Promise<void>;
  hangup(): Promise<void>;
  hold(): Promise<void>;
  unhold(): Promise<void>;
  mute(): void;
  unmute(): void;
  sendDTMF(tone: string): Promise<void>;
  isConnected(): boolean;
}

export function normalizeBrazilianNumber(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits) ? digits : null;
}

export function useSipPhone(
  accessToken: string | undefined,
  onCallEnded: () => void,
) {
  const clientRef = useRef<SipClient | null>(null);
  const configRef = useRef<WebRtcConfig | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<SipPhoneStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    let client: SipClient | undefined;

    const start = async () => {
      try {
        setStatus("connecting");
        setError(null);
        const [config, sipJs] = await Promise.all([
          api.webRtcConfig(accessToken),
          import("sip.js"),
        ]);
        if (cancelled) return;

        configRef.current = config;
        client = new sipJs.Web.SimpleUser(config.wsServer, {
          aor: config.aor,
          delegate: {
            onCallCreated: () => {
              if (!cancelled) setStatus("calling");
            },
            onCallAnswered: () => {
              if (!cancelled) setStatus("active");
            },
            onCallReceived: () => {
              if (!cancelled) setStatus("incoming");
            },
            onCallHangup: () => {
              if (cancelled) return;
              setMuted(false);
              setHeld(false);
              setStatus(client?.isConnected() ? "ready" : "offline");
              onCallEnded();
            },
            onRegistered: () => {
              if (!cancelled) setStatus("ready");
            },
            onServerConnect: () => {
              if (!cancelled) setStatus("connecting");
            },
            onServerDisconnect: () => {
              if (!cancelled) setStatus("offline");
            },
          },
          media: {
            constraints: { audio: true, video: false },
            remote: { audio: remoteAudioRef.current ?? undefined },
          },
          reconnectionAttempts: 5,
          userAgentOptions: {
            authorizationUsername: config.authorizationUsername,
            authorizationPassword: config.authorizationPassword,
            displayName: config.displayName,
            logLevel: "error",
          },
        });
        clientRef.current = client;
        await client.connect();
        if (cancelled) return;
        await client.register();
      } catch (startError) {
        if (cancelled) return;
        setStatus("error");
        setError(
          startError instanceof Error
            ? startError.message
            : "Não foi possível conectar o ramal.",
        );
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (clientRef.current === client) clientRef.current = null;
      configRef.current = null;
      if (client) {
        void client
          .unregister()
          .catch(() => undefined)
          .finally(() => void client?.disconnect().catch(() => undefined));
      }
    };
  }, [accessToken, onCallEnded]);

  const call = useCallback(async (
    phoneNumber: string,
    provider: VoiceProvider = "directcall",
  ) => {
    const destination = normalizeBrazilianNumber(phoneNumber);
    if (!destination) {
      setError("Informe um número brasileiro com DDD.");
      return;
    }
    const client = clientRef.current;
    const config = configRef.current;
    if (!client || !config || status !== "ready") {
      setError("Aguarde o ramal ficar online antes de ligar.");
      return;
    }

    try {
      setError(null);
      setStatus("calling");
      const dialDestination =
        provider === "wavoip"
          ? `*8${destination}`
          : provider === "twilio"
            ? `*9${destination}`
            : provider === "nvoip"
              ? `*7${destination}`
              : destination;
      await client.call(`sip:${dialDestination}@${config.sipDomain}`);
    } catch (callError) {
      setStatus(client.isConnected() ? "ready" : "offline");
      setError(
        callError instanceof DOMException && callError.name === "NotAllowedError"
          ? "Permita o uso do microfone para realizar a ligação."
          : callError instanceof Error
            ? callError.message
            : "Não foi possível iniciar a ligação.",
      );
    }
  }, [status]);

  const answer = useCallback(async () => {
    try {
      setError(null);
      await clientRef.current?.answer();
    } catch (answerError) {
      setError(
        answerError instanceof Error
          ? answerError.message
          : "Não foi possível atender a ligação.",
      );
    }
  }, []);

  const hangup = useCallback(async () => {
    try {
      await clientRef.current?.hangup();
    } catch (hangupError) {
      setError(
        hangupError instanceof Error
          ? hangupError.message
          : "Não foi possível encerrar a ligação.",
      );
    }
  }, []);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client || status !== "active") return;
    if (muted) client.unmute();
    else client.mute();
    setMuted(!muted);
  }, [muted, status]);

  const toggleHold = useCallback(async () => {
    const client = clientRef.current;
    if (!client || status !== "active") return;
    try {
      if (held) await client.unhold();
      else await client.hold();
      setHeld(!held);
    } catch (holdError) {
      setError(
        holdError instanceof Error
          ? holdError.message
          : "Não foi possível alterar a espera da ligação.",
      );
    }
  }, [held, status]);

  const sendDTMF = useCallback(async (tone: string) => {
    if (!/^[0-9*#]$/.test(tone) || status !== "active") return;
    try {
      await clientRef.current?.sendDTMF(tone);
    } catch {
      setError("Não foi possível enviar o tom DTMF.");
    }
  }, [status]);

  return {
    status,
    error,
    muted,
    held,
    remoteAudioRef,
    call,
    answer,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
  };
}
