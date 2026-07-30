export type TranscriptionJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "canceled";

export interface TranscriptionSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence?: number;
}

export interface TranscriptionRequest {
  /** URL assinada e temporária do áudio; o adapter não acessa o storage diretamente. */
  audioUrl: string;
  languageHint?: string;
  /** Melhora a diarização quando o provedor suporta. */
  expectedSpeakers?: number;
  idempotencyKey: string;
}

export interface TranscriptionResult {
  jobId: string;
  status: TranscriptionJobStatus;
  fullText?: string;
  language?: string;
  confidence?: number;
  segments?: TranscriptionSegment[];
  model?: string;
  providerVersion?: string;
  processedAt?: Date;
  errorMessage?: string;
}

export interface TranscriptionStatus {
  jobId: string;
  status: TranscriptionJobStatus;
  errorMessage?: string;
}

export const TRANSCRIPTION_PROVIDER = Symbol("TranscriptionProvider");

export interface TranscriptionProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  getStatus(jobId: string): Promise<TranscriptionStatus>;
}
