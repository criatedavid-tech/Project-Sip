import { setTimeout as delay } from "node:timers/promises";
import { loadTelephonyEnv } from "@omni/config";
import { createDatabase } from "@omni/db";
import { createLogger } from "@omni/observability";
import { AriMonitor } from "./ari-monitor";
import { CallEventStore } from "./call-event-store";
import { LocalWhisperTranscriptionProvider } from "./local-whisper-transcription.provider";
import { MockTranscriptionProvider } from "./mock-transcription.provider";
import { OpenAiTranscriptionProvider } from "./openai-transcription.provider";
import { TranscriptionProcessor } from "./transcription-processor";

async function bootstrap(): Promise<void> {
  const env = loadTelephonyEnv();
  const logger = createLogger({ service: "telephony-worker", level: env.LOG_LEVEL });
  const database = createDatabase({
    // O worker correlaciona o ramal antes de conhecer o tenant. Em produção,
    // esta conexão deve ser uma role própria e restrita a estas três tabelas.
    connectionString: env.DATABASE_ADMIN_URL,
    maxConnections: 2,
  });
  const providerName =
    env.TRANSCRIPTION_PROVIDER_DRIVER === "real"
      ? env.TRANSCRIPTION_PROVIDER
      : "mock";
  const transcriptionProvider =
    providerName === "openai"
      ? new OpenAiTranscriptionProvider({
          apiKey: env.TRANSCRIPTION_API_KEY!,
          model: env.TRANSCRIPTION_MODEL,
          language: env.TRANSCRIPTION_LANGUAGE,
          timeoutMs: env.TRANSCRIPTION_REQUEST_TIMEOUT_MS,
        })
      : providerName === "whisper_local"
        ? new LocalWhisperTranscriptionProvider({
            endpoint: env.TRANSCRIPTION_LOCAL_URL,
            model: env.TRANSCRIPTION_MODEL,
            language: env.TRANSCRIPTION_LANGUAGE,
            timeoutMs: env.TRANSCRIPTION_REQUEST_TIMEOUT_MS,
          })
      : new MockTranscriptionProvider();
  const transcription = new TranscriptionProcessor(
    database.db,
    env.ASTERISK_RECORDINGS_PATH,
    transcriptionProvider,
    { providerName, language: env.TRANSCRIPTION_LANGUAGE },
    logger,
  );
  const eventStore = new CallEventStore(
    database.db,
    env.ASTERISK_RECORDINGS_PATH,
    logger,
  );
  const backlogCount = await transcription.processBacklog();
  logger.info(
    { provider: providerName, backlogCount },
    "processamento de transcrições pronto",
  );
  const backlogTimer = setInterval(() => {
    void transcription
      .processBacklog()
      .then((count) => {
        if (count > 0) {
          logger.info(
            { provider: providerName, backlogCount: count },
            "fila de transcrições pendentes reprocessada",
          );
        }
      })
      .catch((error: unknown) => {
        logger.error(
          { err: error, provider: providerName },
          "falha ao consultar transcrições pendentes",
        );
      });
  }, env.TRANSCRIPTION_BACKLOG_INTERVAL_MS);
  backlogTimer.unref();
  let monitor: AriMonitor | undefined;
  let shuttingDown = false;
  let wakeSupervisor: (() => void) | undefined;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(backlogTimer);
    logger.info({ signal }, "encerrando telephony-worker");
    monitor?.stop();
    wakeSupervisor?.();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  while (!shuttingDown) {
    const permanentFailure = new Promise<void>((resolve) => {
      wakeSupervisor = resolve;
    });

    monitor = new AriMonitor(
      {
        url: env.ASTERISK_ARI_URL,
        username: env.ASTERISK_ARI_USERNAME,
        password: env.ASTERISK_ARI_PASSWORD,
        application: env.ASTERISK_ARI_APP,
      },
      logger,
      () => wakeSupervisor?.(),
    );
    monitor.onRecordingEvent(async (event) => {
      const recording = await eventStore.handle(event);
      if (recording) void transcription.enqueue(recording);
    });

    try {
      await monitor.start();
      await permanentFailure;
    } catch (error) {
      logger.error({ err: error }, "falha ao conectar ao Asterisk ARI");
    } finally {
      monitor.stop();
      monitor = undefined;
    }

    if (!shuttingDown) {
      logger.info(
        { retryInMs: env.ASTERISK_ARI_RECONNECT_DELAY_MS },
        "nova tentativa de conexão ARI agendada",
      );
      await delay(env.ASTERISK_ARI_RECONNECT_DELAY_MS);
    }
  }

  await database.close();
}

void bootstrap().catch((error: unknown) => {
  createLogger({ service: "telephony-worker" }).fatal(
    { err: error },
    "falha fatal no telephony-worker",
  );
  process.exitCode = 1;
});
