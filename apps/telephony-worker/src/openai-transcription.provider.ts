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

const OPENAI_TRANSCRIPTIONS_URL =
  "https://api.openai.com/v1/audio/transcriptions";

interface DiarizedSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  speaker?: unknown;
}

interface TranscriptionPayload {
  text?: unknown;
  duration?: unknown;
  segments?: unknown;
}

export interface OpenAiTranscriptionOptions {
  apiKey: string;
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
  return new ProviderError(message, "openai", code, retryable, cause);
}

function segmentsFrom(payload: TranscriptionPayload): TranscriptionSegment[] {
  if (!Array.isArray(payload.segments)) return [];

  return payload.segments.flatMap((candidate, index) => {
    const segment = candidate as DiarizedSegment;
    if (
      typeof segment.start !== "number" ||
      typeof segment.end !== "number" ||
      typeof segment.text !== "string"
    ) {
      return [];
    }

    return [
      {
        index,
        startMs: Math.max(0, Math.round(segment.start * 1_000)),
        endMs: Math.max(0, Math.round(segment.end * 1_000)),
        text: segment.text.trim(),
        speakerLabel:
          typeof segment.speaker === "string" ? segment.speaker : undefined,
      },
    ];
  });
}

/** Adapter síncrono para POST /v1/audio/transcriptions. */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  private readonly jobs = new Map<string, TranscriptionResult>();
  private readonly byIdempotencyKey = new Map<string, TranscriptionResult>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: OpenAiTranscriptionOptions) {
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
    body.set("model", this.options.model);
    body.set("language", request.languageHint ?? this.options.language);

    const diarized = this.options.model === "gpt-4o-transcribe-diarize";
    if (diarized) {
      body.set("response_format", "diarized_json");
      body.set("chunking_strategy", "auto");
    } else {
      body.set("response_format", "json");
    }

    let response: Response;
    try {
      response = await this.fetcher(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw providerFailure(
        "OpenAI não respondeu à solicitação de transcrição",
        "network_error",
        true,
        error,
      );
    }

    if (!response.ok) {
      throw providerFailure(
        `OpenAI recusou a transcrição (HTTP ${response.status})`,
        `http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | TranscriptionPayload
      | null;
    if (!payload || typeof payload.text !== "string") {
      throw providerFailure(
        "OpenAI devolveu uma transcrição inválida",
        "invalid_response",
        false,
      );
    }

    const jobId = `openai:${request.idempotencyKey}`;
    const result: TranscriptionResult = {
      jobId,
      status: "completed",
      fullText: payload.text.trim(),
      language: request.languageHint ?? this.options.language,
      segments: segmentsFrom(payload),
      model: this.options.model,
      providerVersion: "v1",
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
