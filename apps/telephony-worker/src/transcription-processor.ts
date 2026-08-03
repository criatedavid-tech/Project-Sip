import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { schema, type Database } from "@omni/db";
import type { Logger } from "@omni/observability";
import type { TranscriptionProvider } from "@omni/provider-contracts";

const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/;
const MAX_TRANSCRIPTION_ATTEMPTS = 5;

export interface TranscriptionCandidate {
  organizationId: string;
  recordingId: string;
  storageKey: string;
}

export interface TranscriptionProcessorOptions {
  providerName: "mock" | "openai" | "whisper_local";
  language: string;
}

export class TranscriptionProcessor {
  private readonly recordingsRoot: string;
  private queue = Promise.resolve();

  constructor(
    private readonly db: Database,
    recordingsPath: string,
    private readonly provider: TranscriptionProvider,
    private readonly options: TranscriptionProcessorOptions,
    private readonly logger: Logger,
  ) {
    this.recordingsRoot = resolve(recordingsPath);
  }

  enqueue(candidate: TranscriptionCandidate): Promise<void> {
    const task = this.queue.then(() => this.process(candidate));
    this.queue = task.catch((error: unknown) => {
      this.logger.error(
        { err: error, recordingId: candidate.recordingId },
        "falha inesperada na fila de transcrição",
      );
    });
    return task;
  }

  async processBacklog(): Promise<number> {
    const candidates = await this.db
      .select({
        organizationId: schema.callRecordings.organizationId,
        recordingId: schema.callRecordings.id,
        storageKey: schema.callRecordings.storageKey,
      })
      .from(schema.callRecordings)
      .leftJoin(
        schema.callTranscriptions,
        eq(schema.callTranscriptions.recordingId, schema.callRecordings.id),
      )
      .where(
        and(
          eq(schema.callRecordings.status, "available"),
          or(
            isNull(schema.callTranscriptions.id),
            ne(schema.callTranscriptions.provider, this.options.providerName),
            and(
              inArray(schema.callTranscriptions.status, ["pending", "failed"]),
              lt(
                schema.callTranscriptions.attemptCount,
                MAX_TRANSCRIPTION_ATTEMPTS,
              ),
              or(
                isNull(schema.callTranscriptions.nextRetryAt),
                lte(schema.callTranscriptions.nextRetryAt, new Date()),
              ),
            ),
          ),
        ),
      )
      .limit(100);

    for (const candidate of candidates) {
      await this.enqueue(candidate);
    }
    return candidates.length;
  }

  private async process(candidate: TranscriptionCandidate): Promise<void> {
    if (!SAFE_STORAGE_KEY.test(candidate.storageKey)) {
      this.logger.warn(
        { recordingId: candidate.recordingId },
        "gravação com chave inválida não foi transcrita",
      );
      return;
    }

    const filePath = resolve(this.recordingsRoot, `${candidate.storageKey}.wav`);
    if (!filePath.startsWith(`${this.recordingsRoot}${sep}`)) return;
    const file = await stat(filePath).catch(() => null);
    if (!file?.isFile() || file.size <= 44) {
      this.logger.warn(
        { recordingId: candidate.recordingId },
        "gravação vazia ou ausente não foi transcrita",
      );
      return;
    }

    await this.db
      .insert(schema.callTranscriptions)
      .values({
        organizationId: candidate.organizationId,
        recordingId: candidate.recordingId,
        provider: this.options.providerName,
      })
      .onConflictDoNothing();

    const [current] = await this.db
      .select({
        id: schema.callTranscriptions.id,
        status: schema.callTranscriptions.status,
        provider: schema.callTranscriptions.provider,
        attemptCount: schema.callTranscriptions.attemptCount,
      })
      .from(schema.callTranscriptions)
      .where(eq(schema.callTranscriptions.recordingId, candidate.recordingId))
      .limit(1);
    if (!current) throw new Error("não foi possível preparar a transcrição");
    if (
      current.status === "completed" &&
      current.provider === this.options.providerName
    ) {
      return;
    }

    const startedAt = new Date();
    const attemptCount = current.attemptCount + 1;
    await this.db
      .update(schema.callTranscriptions)
      .set({
        status: "processing",
        provider: this.options.providerName,
        providerJobId: null,
        model: null,
        language: this.options.language,
        fullText: null,
        segments: null,
        errorMessage: null,
        attemptCount,
        nextRetryAt: null,
        startedAt,
        completedAt: null,
        updatedAt: startedAt,
      })
      .where(eq(schema.callTranscriptions.id, current.id));

    try {
      const result = await this.provider.transcribe({
        audioUrl: pathToFileURL(filePath).toString(),
        languageHint: this.options.language,
        expectedSpeakers: 2,
        idempotencyKey: candidate.recordingId,
      });
      const completedAt = result.processedAt ?? new Date();
      await this.db
        .update(schema.callTranscriptions)
        .set({
          status: result.status,
          providerJobId: result.jobId,
          model: result.model ?? null,
          language: result.language ?? this.options.language,
          fullText: result.fullText ?? null,
          segments: result.segments ?? null,
          errorMessage: result.errorMessage ?? null,
          nextRetryAt: null,
          completedAt: result.status === "completed" ? completedAt : null,
          updatedAt: completedAt,
        })
        .where(eq(schema.callTranscriptions.id, current.id));

      this.logger.info(
        {
          recordingId: candidate.recordingId,
          provider: this.options.providerName,
          status: result.status,
          segmentCount: result.segments?.length ?? 0,
        },
        "transcrição processada",
      );
    } catch (error) {
      const failedAt = new Date();
      const retryDelayMinutes = Math.min(30, 2 ** Math.max(0, attemptCount - 1));
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "falha desconhecida na transcrição";
      await this.db
        .update(schema.callTranscriptions)
        .set({
          status: "failed",
          errorMessage: message,
          nextRetryAt:
            attemptCount < MAX_TRANSCRIPTION_ATTEMPTS
              ? new Date(failedAt.getTime() + retryDelayMinutes * 60_000)
              : null,
          completedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(schema.callTranscriptions.id, current.id));
      this.logger.error(
        {
          err: error,
          recordingId: candidate.recordingId,
          provider: this.options.providerName,
        },
        "transcrição falhou",
      );
    }
  }
}
