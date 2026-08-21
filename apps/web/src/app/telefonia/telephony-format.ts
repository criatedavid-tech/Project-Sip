import type { CallTranscription } from "@/lib/api-client";

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Desconhecido",
  unassigned: "Sem ramal",
  ringing: "Chamando",
  answered: "Em andamento",
  completed: "Concluída",
  failed: "Falhou",
  available: "Disponível",
  pending: "Processando",
  processing: "Processando",
  busy: "Ocupado",
  no_answer: "Não atendida",
  cancelled: "Cancelada",
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatTimestamp(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function providerLabel(provider: string) {
  if (provider === "wavoip") return "WhatsApp";
  if (provider === "directcall") return "Telefone";
  if (provider === "twilio") return "Telefone (Twilio)";
  if (provider === "nvoip") return "Telefone (Nvoip)";
  if (provider === "internal") return "Interna";
  return "Não identificado";
}

export function transcriptionLabel(transcription: CallTranscription | null) {
  if (!transcription) return "Aguardando transcrição";
  if (transcription.provider === "mock" && transcription.status === "completed") {
    return "Simulação";
  }
  if (transcription.status === "completed") return "Transcrição pronta";
  if (transcription.status === "processing") return "Transcrevendo";
  if (transcription.status === "failed") return "Transcrição falhou";
  return "Aguardando transcrição";
}

export function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
