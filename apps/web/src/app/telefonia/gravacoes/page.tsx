"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import {
  api,
  type CallRecording,
  type TelephonyListResponse,
  type TelephonyOverview,
} from "@/lib/api-client";
import {
  formatDate,
  formatDuration,
  formatTimestamp,
  providerLabel,
  transcriptionLabel,
  todayInSaoPaulo,
} from "../telephony-format";
import styles from "../telefonia.module.css";

export default function RecordingsPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [date, setDate] = useState(todayInSaoPaulo);
  const [userId, setUserId] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [overview, setOverview] = useState<TelephonyOverview | null>(null);
  const [result, setResult] =
    useState<TelephonyListResponse<CallRecording> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingAudio, setRecordingAudio] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [loadingRecordingId, setLoadingRecordingId] = useState<string | null>(null);
  const [retryingRecordingId, setRetryingRecordingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, router, session]);

  useEffect(() => {
    if (!session) return;
    void api.telephonyOverview(session.accessToken).then(setOverview).catch(() => null);
  }, [session]);

  useEffect(
    () => () => {
      if (recordingAudio) URL.revokeObjectURL(recordingAudio.url);
    },
    [recordingAudio],
  );

  const loadRecordings = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      setResult(
        await api.telephonyRecordings(session.accessToken, {
          date,
          userId: userId || undefined,
          provider: provider || undefined,
          status: status || undefined,
        }),
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar as gravações.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [date, provider, session, status, userId]);

  useEffect(() => {
    void loadRecordings();
  }, [loadRecordings]);

  const playRecording = useCallback(
    async (recordingId: string) => {
      if (!session) return;
      setLoadingRecordingId(recordingId);
      setError(null);
      try {
        const blob = await api.recordingAudio(session.accessToken, recordingId);
        const url = URL.createObjectURL(blob);
        setRecordingAudio((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return { id: recordingId, url };
        });
      } catch (audioError) {
        setError(
          audioError instanceof Error
            ? audioError.message
            : "Não foi possível carregar a gravação.",
        );
      } finally {
        setLoadingRecordingId(null);
      }
    },
    [session],
  );

  const retryTranscription = useCallback(
    async (recordingId: string) => {
      if (!session) return;
      setRetryingRecordingId(recordingId);
      setError(null);
      try {
        await api.retryTranscription(session.accessToken, recordingId);
        await loadRecordings();
      } catch (retryError) {
        setError(
          retryError instanceof Error
            ? retryError.message
            : "Não foi possível reenviar a transcrição.",
        );
      } finally {
        setRetryingRecordingId(null);
      }
    },
    [loadRecordings, session],
  );

  if (loading || !session) {
    return <main className={styles.loading}>Carregando gravações...</main>;
  }

  const ownScope = result?.scope === "own" || session.user.roleKey === "agent";

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.content}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Áudio e texto</p>
            <h1>{ownScope ? "Minhas gravações" : "Gravações da equipe"}</h1>
            <p className={styles.subtitle}>
              Ouça o áudio e acompanhe a transcrição de cada atendimento.
            </p>
          </div>
          <Link className={styles.refresh} href="/telefonia">
            Voltar para telefonia
          </Link>
        </section>

        <section className={styles.filters} aria-label="Filtros de gravações">
          <label className={styles.filterField}>
            <span>Dia da chamada</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          {!ownScope ? (
            <label className={styles.filterField}>
              <span>Colaborador</span>
              <select value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="">Todos</option>
                {overview?.team.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}{member.extension ? ` · Ramal ${member.extension}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={styles.filterField}>
            <span>Canal</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">Todos</option>
              <option value="directcall">Telefone</option>
              <option value="wavoip">WhatsApp</option>
              <option value="twilio">Telefone (Twilio)</option>
              <option value="internal">Interna</option>
            </select>
          </label>
          <label className={styles.filterField}>
            <span>Arquivo</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos</option>
              <option value="available">Disponível</option>
              <option value="processing">Processando</option>
              <option value="not_recorded">Sem gravação</option>
              <option value="failed">Falhou</option>
            </select>
          </label>
          <button
            className={styles.refresh}
            disabled={refreshing}
            onClick={() => void loadRecordings()}
            type="button"
          >
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </section>

        {ownScope ? (
          <p className={styles.scopeNotice}>
            Você visualiza e reproduz somente gravações das suas próprias chamadas.
          </p>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Resultado do dia</h2>
              <p>Arquivos e transcrições das chamadas selecionadas.</p>
            </div>
            <span className={styles.count}>{result?.items.length ?? 0}</span>
          </div>
          {result?.items.length ? (
            <div className={styles.recordingList}>
              {result.items.map((recording) => (
                <article className={styles.recordingRow} key={recording.id}>
                  <div>
                    <span>{providerLabel(recording.provider)}</span>
                    <strong>{recording.userName ?? "Não atribuída"}</strong>
                    <span>
                      {recording.extension ?? "—"} · {recording.fromNumber ?? "—"} →{" "}
                      {recording.toNumber ?? "—"}
                    </span>
                  </div>
                  <span>{formatDate(recording.availableAt ?? recording.createdAt)}</span>
                  <span>{formatDuration(recording.durationSeconds)}</span>
                  <div className={styles.recordingAction}>
                    <span
                      className={`${styles.status} ${
                        recording.status === "available"
                          ? styles.statusGood
                          : recording.status === "failed"
                            ? styles.statusBad
                            : styles.statusNeutral
                      }`}
                    >
                      {recording.status === "available"
                        ? "Disponível"
                        : recording.status === "not_recorded"
                          ? "Sem gravação"
                          : recording.status === "failed"
                            ? "Falhou"
                            : recording.status}
                    </span>
                    {recording.status === "available" ? (
                      <button
                        className={styles.listenButton}
                        disabled={loadingRecordingId === recording.id}
                        onClick={() => void playRecording(recording.id)}
                        type="button"
                      >
                        {loadingRecordingId === recording.id ? "Carregando..." : "Ouvir"}
                      </button>
                    ) : null}
                  </div>
                  {recordingAudio?.id === recording.id ? (
                    <audio
                      className={styles.recordingPlayer}
                      controls
                      autoPlay
                      src={recordingAudio.url}
                    />
                  ) : null}
                  <div className={styles.transcriptionState}>
                    <span
                      className={`${styles.status} ${
                        recording.transcription?.status === "completed" &&
                        recording.transcription.provider !== "mock"
                          ? styles.statusGood
                          : recording.transcription?.status === "failed"
                            ? styles.statusBad
                            : styles.statusNeutral
                      }`}
                    >
                      {transcriptionLabel(recording.transcription)}
                    </span>
                    {recording.transcription?.status === "failed" ? (
                      <>
                        <small>
                          {recording.transcription.errorMessage ??
                            "Não foi possível transcrever esta chamada."}
                        </small>
                        <button
                          className={styles.listenButton}
                          disabled={retryingRecordingId === recording.id}
                          onClick={() => void retryTranscription(recording.id)}
                          type="button"
                        >
                          {retryingRecordingId === recording.id
                            ? "Reenviando..."
                            : "Tentar novamente"}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {recording.transcription?.status === "completed" &&
                  recording.transcription.fullText ? (
                    <details className={styles.transcriptionPanel}>
                      <summary>Ver transcrição</summary>
                      {recording.transcription.provider === "mock" ? (
                        <p className={styles.mockNotice}>
                          Demonstração: nenhuma fala real foi enviada ou transcrita.
                        </p>
                      ) : null}
                      {recording.transcription.segments?.length ? (
                        <div className={styles.transcriptionSegments}>
                          {recording.transcription.segments.map((segment) => (
                            <p key={`${recording.id}-${segment.index}`}>
                              <strong>
                                {formatTimestamp(segment.startMs)} ·{" "}
                                {segment.speakerLabel
                                  ? `Falante ${segment.speakerLabel}`
                                  : `Trecho ${segment.index + 1}`}
                              </strong>
                              <span>{segment.text}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.transcriptionText}>
                          {recording.transcription.fullText}
                        </p>
                      )}
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>Nenhuma gravação encontrada</strong>
              <span>Altere os filtros ou escolha outro dia.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
