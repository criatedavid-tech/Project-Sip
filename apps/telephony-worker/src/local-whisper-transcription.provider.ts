import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProviderError,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
  type TranscriptionSegment,
  type TranscriptionStatus,
} from "@omni/provider-contracts";

interface LocalWhisperSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  confidence?: unknown;
}

interface LocalWhisperPayload {
  text?: unknown;
  language?: unknown;
  model?: unknown;
  version?: unknown;
  segments?: unknown;
}

export interface LocalWhisperTranscriptionOptions {
  endpoint: string;
  model: string;
  language: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
}

function providerFailure(
  message: string,
  code: string,
  retryable: boolean,
  cause?: unknown,
) {
  return new ProviderError(message, "whisper_local", code, retryable, cause);
}

function segmentsFrom(payload: LocalWhisperPayload): TranscriptionSegment[] {
  if (!Array.isArray(payload.segments)) return [];

  return payload.segments.flatMap((candidate, index) => {
    const segment = candidate as LocalWhisperSegment;
    if (
      typeof segment.start !== "number" ||
      typeof segment.end !== "number" ||
      typeof segment.text !== "string"
    ) {
      return [];
    }

    const confidence =
      typeof segment.confidence === "number" &&
      Number.isFinite(segment.confidence)
        ? Math.max(0, Math.min(1, segment.confidence))
        : undefined;

    return [
      {
        index,
        startMs: Math.max(0, Math.round(segment.start * 1_000)),
        endMs: Math.max(0, Math.round(segment.end * 1_000)),
        text: segment.text.trim(),
        ...(confidence === undefined ? {} : { confidence }),
      },
    ];
  });
}

/** Envia o WAV ao faster-whisper privado que roda na mesma máquina/VPS. */
export class LocalWhisperTranscriptionProvider
  implements TranscriptionProvider
{
  private readonly jobs = new Map<string, TranscriptionResult>();
  private readonly byIdempotencyKey = new Map<string, TranscriptionResult>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: LocalWhisperTranscriptionOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing) return existing;

    const audio = await this.readAudio(request.audioUrl);
    const body = new FormData();
    body.set(
      "file",
      new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
      basename(fileURLToPath(request.audioUrl)),
    );
    body.set("language", request.languageHint ?? this.options.language);
    body.set("idempotency_key", request.idempotencyKey);

    let response: Response;
    try {
      response = await this.fetcher(this.options.endpoint, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw providerFailure(
        "Whisper local não respondeu à solicitação de transcrição",
        "network_error",
        true,
        error,
      );
    }

    if (!response.ok) {
      throw providerFailure(
        `Whisper local recusou a transcrição (HTTP ${response.status})`,
        `http_${response.status}`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | LocalWhisperPayload
      | null;
    if (!payload || typeof payload.text !== "string") {
      throw providerFailure(
        "Whisper local devolveu uma transcrição inválida",
        "invalid_response",
        false,
      );
    }

    const jobId = `whisper_local:${request.idempotencyKey}`;
    const result: TranscriptionResult = {
      jobId,
      status: "completed",
      fullText: payload.text.trim(),
      language:
        typeof payload.language === "string"
          ? payload.language
          : request.languageHint ?? this.options.language,
      segments: segmentsFrom(payload),
      model:
        typeof payload.model === "string" ? payload.model : this.options.model,
      providerVersion:
        typeof payload.version === "string" ? payload.version : "faster-whisper",
      processedAt: new Date(),
    };
    this.jobs.set(jobId, result);
    this.byIdempotencyKey.set(request.idempotencyKey, result);
    return result;
  }

  async getStatus(jobId: string): Promise<TranscriptionStatus> {
    const job = this.jobs.get(jobId);
    return job
      ? { jobId, status: job.status, errorMessage: job.errorMessage }
      : { jobId, status: "failed", errorMessage: "job inexistente" };
  }

  private async readAudio(audioUrl: string): Promise<Uint8Array> {
    let path: string;
    try {
      const url = new URL(audioUrl);
      if (url.protocol !== "file:") throw new Error("protocolo não suportado");
      path = fileURLToPath(url);
    } catch (error) {
      throw providerFailure(
        "origem de áudio inválida",
        "invalid_audio_url",
        false,
        error,
      );
    }

    try {
      return await readFile(path);
    } catch (error) {
      throw providerFailure(
        "arquivo de áudio indisponível",
        "audio_unavailable",
        false,
        error,
      );
    }
  }
}
