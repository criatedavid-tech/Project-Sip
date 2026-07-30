import {
  ProviderError,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
  type TranscriptionStatus,
} from "@omni/provider-contracts";

export interface MockTranscriptionOptions {
  fullText?: string;
  failTranscribe?: { code: string; retryable: boolean };
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  private counter = 0;
  private readonly jobs = new Map<string, TranscriptionResult>();
  private readonly byIdempotencyKey = new Map<string, TranscriptionResult>();

  constructor(private readonly options: MockTranscriptionOptions = {}) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }
    if (this.options.failTranscribe) {
      throw new ProviderError(
        "mock: falha simulada na transcrição",
        "mock-transcription",
        this.options.failTranscribe.code,
        this.options.failTranscribe.retryable,
      );
    }
    this.counter += 1;
    const fullText = this.options.fullText ?? "Transcrição simulada da chamada.";
    const result: TranscriptionResult = {
      jobId: `mock-transcription-${this.counter}`,
      status: "completed",
      fullText,
      language: request.languageHint ?? "pt",
      confidence: 0.95,
      segments: [
        { index: 0, startMs: 0, endMs: 2000, text: fullText, speakerLabel: "SPEAKER_00" },
      ],
      model: "mock-model-v1",
      providerVersion: "mock-1.0.0",
      processedAt: new Date(),
    };
    this.jobs.set(result.jobId, result);
    this.byIdempotencyKey.set(request.idempotencyKey, result);
    return result;
  }

  async getStatus(jobId: string): Promise<TranscriptionStatus> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { jobId, status: "failed", errorMessage: "job inexistente" };
    }
    return { jobId, status: job.status };
  }
}
