import { Buffer } from "node:buffer";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import type { Logger } from "@omni/observability";

export interface AriMonitorConfig {
  url: string;
  username: string;
  password: string;
  application: string;
}

export interface AriSocket {
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  close(code?: number, reason?: string): void;
}

export type AriConnector = (url: URL, options: ClientOptions) => AriSocket;
export type PermanentFailureHandler = (error: Error) => void;
export type RecordingLifecycleStage = "started" | "finished";

export interface RecordingLifecycleEvent {
  stage: RecordingLifecycleStage;
  recordingId?: string;
  callId?: string;
  linkedId?: string;
  direction?: string;
  provider?: string;
  fromNumber?: string;
  toNumber?: string;
  extension?: string;
  dialStatus?: string;
  durationMs?: string;
}

export type RecordingLifecycleHandler = (
  event: RecordingLifecycleEvent,
) => void | Promise<void>;

interface AriChannel {
  id: string;
  name?: string;
  state?: string;
}

interface AriRecording {
  name?: string;
}

interface AriEvent {
  type: string;
  channel?: AriChannel;
  caller?: AriChannel;
  peer?: AriChannel;
  dialstatus?: string;
  cause?: number;
  cause_txt?: string;
  recording?: AriRecording;
  eventname?: string;
  userevent?: Record<string, unknown>;
}

function channelFields(channel: AriChannel | undefined): Record<string, string | undefined> {
  return {
    channelId: channel?.id,
    // O nome completo de um canal PJSIP pode conter o telefone discado.
    channelTechnology: channel?.name?.split("/", 1)[0],
    channelState: channel?.state,
  };
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function websocketUrl(baseUrl: string, application: string): URL {
  const url = new URL("/ari/events", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("app", application);
  url.searchParams.set("subscribeAll", "true");
  return url;
}

const createSocket: AriConnector = (url, options) => new WebSocket(url, options);

/**
 * Assina os eventos do ARI e os traduz para logs estruturados. A discagem e o
 * áudio continuam no dialplan nesta etapa, reduzindo o risco operacional.
 */
export class AriMonitor {
  private socket: AriSocket | undefined;
  private intentionalStop = false;
  private failureReported = false;
  private recordingEventHandler: RecordingLifecycleHandler = () => undefined;
  private recordingEventQueue = Promise.resolve();

  constructor(
    private readonly config: AriMonitorConfig,
    private readonly logger: Logger,
    private readonly onPermanentFailure: PermanentFailureHandler = () => undefined,
    private readonly connector: AriConnector = createSocket,
  ) {}

  onRecordingEvent(handler: RecordingLifecycleHandler): void {
    this.recordingEventHandler = handler;
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }

    this.intentionalStop = false;
    this.failureReported = false;
    const url = websocketUrl(this.config.url, this.config.application);
    const authorization = Buffer.from(
      `${this.config.username}:${this.config.password}`,
      "utf8",
    ).toString("base64");

    this.logger.info(
      { ariUrl: this.config.url, application: this.config.application },
      "conectando ao Asterisk ARI",
    );

    const socket = this.connector(url, {
      headers: { Authorization: `Basic ${authorization}` },
    });
    this.socket = socket;
    this.registerListeners(socket);

    await new Promise<void>((resolve, reject) => {
      const failInitialConnection = (value: unknown) => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        reject(value instanceof Error ? value : new Error("conexão ARI recusada"));
      };

      socket.once("open", () => resolve());
      socket.once("error", failInitialConnection);
      socket.once("unexpected-response", (_request, response) => {
        const statusCode =
          typeof response === "object" && response && "statusCode" in response
            ? response.statusCode
            : "desconhecido";
        failInitialConnection(new Error(`Asterisk recusou ARI (HTTP ${statusCode})`));
      });
    });
  }

  stop(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.intentionalStop = true;
    socket?.close(1000, "shutdown");
  }

  private registerListeners(socket: AriSocket): void {
    socket.on("open", () => {
      this.logger.info(
        { application: this.config.application },
        "Asterisk ARI conectado",
      );
    });

    socket.on("message", (data) => this.handleMessage(data as RawData));

    socket.on("error", (value) => {
      if (this.intentionalStop) return;
      const error = value instanceof Error ? value : new Error("erro no WebSocket ARI");
      this.logger.error({ err: error }, "WebSocket ARI falhou");
    });

    socket.on("close", (code, reason) => {
      if (this.intentionalStop) return;
      const closeCode = typeof code === "number" ? code : 0;
      const closeReason = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason ?? "");
      this.reportFailure(
        new Error(`WebSocket ARI encerrado (código ${closeCode}${closeReason ? `: ${closeReason}` : ""})`),
      );
    });
  }

  private reportFailure(error: Error): void {
    if (this.failureReported) return;
    this.failureReported = true;
    this.socket = undefined;
    this.logger.error({ err: error }, "conexão ARI indisponível");
    this.onPermanentFailure(error);
  }

  private handleMessage(data: RawData): void {
    let event: AriEvent;
    try {
      event = JSON.parse(data.toString()) as AriEvent;
    } catch (error) {
      this.logger.warn({ err: error }, "evento ARI inválido ignorado");
      return;
    }

    switch (event.type) {
      case "ChannelCreated":
        this.logger.info(
          { event: "telephony.channel.created", ...channelFields(event.channel) },
          "canal telefônico criado",
        );
        break;
      case "ChannelStateChange":
        this.logger.info(
          { event: "telephony.channel.state_changed", ...channelFields(event.channel) },
          "estado do canal telefônico alterado",
        );
        break;
      case "Dial":
        this.logger.info(
          {
            event: "telephony.call.dial",
            callerChannelId: event.caller?.id,
            peerChannelId: event.peer?.id,
            dialStatus: event.dialstatus,
          },
          "estado da tentativa de chamada alterado",
        );
        break;
      case "ChannelDestroyed":
        this.logger.info(
          {
            event: "telephony.channel.destroyed",
            ...channelFields(event.channel),
            hangupCause: event.cause,
            hangupReason: event.cause_txt,
          },
          "canal telefônico encerrado",
        );
        break;
      case "ChannelUserevent":
        this.handleUserEvent(event);
        break;
      case "RecordingStarted":
      case "RecordingFinished":
      case "RecordingFailed":
        this.handleNativeRecordingEvent(event);
        break;
      case "ApplicationReplaced":
        this.logger.error(
          { application: this.config.application },
          "outra conexão assumiu a aplicação ARI",
        );
        break;
    }
  }

  private handleNativeRecordingEvent(event: AriEvent): void {
    const stage = event.type.replace("Recording", "").toLowerCase();
    const fields = {
      event: `telephony.recording.${stage}`,
      recordingName: event.recording?.name,
    };

    if (event.type === "RecordingFailed") {
      this.logger.error(fields, "gravação ARI falhou");
    } else {
      this.logger.info(
        fields,
        event.type === "RecordingStarted" ? "gravação ARI iniciada" : "gravação ARI concluída",
      );
    }
  }

  private handleUserEvent(event: AriEvent): void {
    if (
      event.eventname !== "OmniRecordingStarted" &&
      event.eventname !== "OmniRecordingFinished"
    ) {
      return;
    }

    const variables = event.userevent ?? {};
    const recordingId = textValue(variables.RecordingId);
    const direction = textValue(variables.Direction);
    const provider = textValue(variables.Provider);
    const dialStatus = textValue(variables.DialStatus);
    const durationMs = textValue(variables.DurationMs);
    const callId = textValue(variables.CallId);
    const linkedId = textValue(variables.LinkedId);
    const fromNumber = textValue(variables.FromNumber);
    const toNumber = textValue(variables.ToNumber);
    const extension = textValue(variables.Extension);
    const stage = event.eventname === "OmniRecordingStarted" ? "started" : "finished";

    this.logger.info(
      {
        event: `telephony.recording.${stage}`,
        recordingId,
        direction,
        provider,
        dialStatus,
        durationMs,
        callId,
        linkedId,
        fromNumber,
        toNumber,
        extension,
        channelId: event.channel?.id,
      },
      stage === "started" ? "gravação solicitada" : "gravação finalizada",
    );

    const lifecycleEvent: RecordingLifecycleEvent = {
      stage,
      recordingId,
      callId,
      linkedId,
      direction,
      provider,
      fromNumber,
      toNumber,
      extension,
      dialStatus,
      durationMs,
    };
    this.recordingEventQueue = this.recordingEventQueue
      .then(() => this.recordingEventHandler(lifecycleEvent))
      .catch((error: unknown) => {
        this.logger.error(
          { err: error, recordingId, callId },
          "falha ao processar evento de gravação",
        );
      });
  }
}
