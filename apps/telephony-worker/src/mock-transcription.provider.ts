import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionStatus,
} from "@omni/provider-contracts";

/** Mantém o pipeline verificável sem enviar áudio para um serviço externo. */
export class MockTranscriptionProvider implements TranscriptionProvider {
  private readonly jobs = new Map<string, TranscriptionResult>();

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const jobId = `mock:${request.idempotencyKey}`;
    const existing = this.jobs.get(jobId);
    if (existing) return existing;

    const fullText =
      "Transcrição simulada. Configure a chave da OpenAI para transcrever o áudio real.";
    const result: TranscriptionResult = {
      jobId,
      status: "completed",
      fullText,
      language: request.languageHint ?? "pt",
      model: "mock",
      providerVersion: "mock-v1",
      processedAt: new Date(),
    };
    this.jobs.set(jobId, result);
    return result;
  }

  async getStatus(jobId: string): Promise<TranscriptionStatus> {
    const job = this.jobs.get(jobId);
    return job
      ? { jobId, status: job.status }
      : { jobId, status: "failed", errorMessage: "job inexistente" };
  }
}
