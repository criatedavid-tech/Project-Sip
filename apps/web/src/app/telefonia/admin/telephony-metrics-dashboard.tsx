"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type DashboardGranularity,
  type TelephonyDashboardFilters,
  type TelephonyDashboardResponse,
  type VoiceCall,
} from "@/lib/api-client";
import {
  formatDate,
  formatDuration,
  formatTimestamp,
  providerLabel,
  statusLabel,
  todayInSaoPaulo,
} from "../telephony-format";
import styles from "../telefonia.module.css";

const GRANULARITIES: Array<{ value: DashboardGranularity; label: string }> = [
  { value: "hour", label: "Hora" },
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

const INITIAL_FILTERS: TelephonyDashboardFilters = {
  startDate: todayInSaoPaulo(),
  endDate: todayInSaoPaulo(),
  granularity: "hour",
};

function statusClass(status: string) {
  if (["completed", "answered"].includes(status)) return styles.statusGood;
  if (["failed", "busy", "no_answer", "cancelled"].includes(status)) {
    return styles.statusBad;
  }
  return styles.statusNeutral;
}

function directionLabel(direction: string) {
  if (direction === "inbound") return "Entrada";
  if (direction === "outbound") return "Saída";
  return "Não identificada";
}

function displayDuration(value: number | null) {
  return value === null ? "Não disponível" : formatDuration(value);
}

function safeCsvCell(value: string | number | null) {
  let text = value === null ? "Não disponível" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(items: VoiceCall[]) {
  const headers = [
    "Direção",
    "Nome do contato",
    "Número do contato",
    "Colaborador",
    "Ramal",
    "Canal/provedor",
    "Data e horário",
    "Tempo de conversação (s)",
    "Tempo até atendimento (s)",
    "Tempo de pós-atendimento (s)",
    "Status",
  ];
  const rows = items.map((call) => [
    directionLabel(call.direction),
    call.contactName ?? "Não identificado",
    call.contactNumber ?? "Não disponível",
    call.userName ?? "Não atribuída",
    call.extension ?? "Não disponível",
    providerLabel(call.provider),
    formatDate(call.startedAt),
    call.durationSeconds,
    call.answerTimeSeconds,
    call.wrapUpTimeSeconds,
    statusLabel(call.status),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => safeCsvCell(cell)).join(";"))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `metricas-telefonia-${todayInSaoPaulo()}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function CallsChart({
  series,
}: {
  series: TelephonyDashboardResponse["timeSeries"];
}) {
  const chart = useMemo(() => {
    const maxValue = Math.max(1, ...series.flatMap((item) => [item.inbound, item.outbound]));
    const xFor = (index: number) =>
      series.length <= 1 ? 480 : 54 + (index / (series.length - 1)) * 852;
    const yFor = (value: number) => 226 - (value / maxValue) * 176;
    const points = (key: "inbound" | "outbound") =>
      series.map((item, index) => `${xFor(index)},${yFor(item[key])}`).join(" ");
    return { maxValue, xFor, yFor, inbound: points("inbound"), outbound: points("outbound") };
  }, [series]);

  if (series.length === 0) {
    return (
      <div className={styles.chartEmpty}>
        <strong>Sem ligações neste período</strong>
        <span>O gráfico será preenchido quando houver dados para os filtros aplicados.</span>
      </div>
    );
  }

  const labelStep = Math.max(1, Math.ceil(series.length / 8));
  return (
    <div className={styles.chartCanvas}>
      <svg
        aria-label="Quantidade de ligações de entrada e saída ao longo do tempo"
        className={styles.chartSvg}
        role="img"
        viewBox="0 0 960 280"
      >
        {[0, 1, 2, 3, 4].map((line) => {
          const value = Math.round((chart.maxValue * (4 - line)) / 4);
          const y = 50 + line * 44;
          return (
            <g key={line}>
              <line className={styles.chartGridLine} x1="54" x2="906" y1={y} y2={y} />
              <text className={styles.chartAxisText} x="44" y={y + 4} textAnchor="end">
                {value}
              </text>
            </g>
          );
        })}
        <polyline className={styles.chartInboundLine} fill="none" points={chart.inbound} />
        <polyline className={styles.chartOutboundLine} fill="none" points={chart.outbound} />
        {series.map((item, index) => (
          <g key={item.key}>
            <circle
              className={styles.chartInboundPoint}
              cx={chart.xFor(index)}
              cy={chart.yFor(item.inbound)}
              r="4"
            />
            <circle
              className={styles.chartOutboundPoint}
              cx={chart.xFor(index)}
              cy={chart.yFor(item.outbound)}
              r="4"
            />
            {index % labelStep === 0 || index === series.length - 1 ? (
              <text
                className={styles.chartAxisText}
                x={chart.xFor(index)}
                y="254"
                textAnchor="middle"
              >
                {item.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className={styles.chartLegend}>
        <span><i className={styles.legendInbound} />Entrada</span>
        <span><i className={styles.legendOutbound} />Saída</span>
      </div>
    </div>
  );
}

export function TelephonyMetricsDashboard({ accessToken }: { accessToken: string }) {
  const [draftFilters, setDraftFilters] = useState(INITIAL_FILTERS);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [dashboard, setDashboard] = useState<TelephonyDashboardResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ recordingId: string; url: string } | null>(null);
  const [loadingRecordingId, setLoadingRecordingId] = useState<string | null>(null);
  const [openTranscriptionCallId, setOpenTranscriptionCallId] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      setDashboard(await api.telephonyAdminDashboard(accessToken, filters));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar as métricas de telefonia.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, filters]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );

  const playRecording = useCallback(
    async (recordingId: string) => {
      setLoadingRecordingId(recordingId);
      setError(null);
      try {
        const blob = await api.recordingAudio(accessToken, recordingId);
        const url = URL.createObjectURL(blob);
        setAudio((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return { recordingId, url };
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
    [accessToken],
  );

  const clearFilters = () => {
    const initial = { ...INITIAL_FILTERS, startDate: todayInSaoPaulo(), endDate: todayInSaoPaulo() };
    setDraftFilters(initial);
    setFilters(initial);
  };

  return (
    <section className={styles.dashboardSection} aria-labelledby="telephony-dashboard-title">
      <div className={styles.dashboardHeading}>
        <div>
          <p className={styles.eyebrow}>Métricas consolidadas</p>
          <h2 id="telephony-dashboard-title">Visão geral da telefonia</h2>
          <p>Indicadores, evolução e histórico detalhado com dados reais das chamadas.</p>
        </div>
        <button
          className={styles.exportButton}
          disabled={!dashboard?.items.length}
          onClick={() => downloadCsv(dashboard?.items ?? [])}
          type="button"
        >
          Exportar CSV
        </button>
      </div>

      <form
        className={styles.dashboardFilters}
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draftFilters);
        }}
      >
        <label className={styles.filterField}>
          <span>Data inicial</span>
          <input
            max={draftFilters.endDate}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, startDate: event.target.value }))
            }
            type="date"
            value={draftFilters.startDate}
          />
        </label>
        <label className={styles.filterField}>
          <span>Data final</span>
          <input
            min={draftFilters.startDate}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, endDate: event.target.value }))
            }
            type="date"
            value={draftFilters.endDate}
          />
        </label>
        <label className={styles.filterField}>
          <span>Direção</span>
          <select
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                direction: (event.target.value || undefined) as
                  | "inbound"
                  | "outbound"
                  | undefined,
              }))
            }
            value={draftFilters.direction ?? ""}
          >
            <option value="">Entrada e saída</option>
            <option value="inbound">Entrada</option>
            <option value="outbound">Saída</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Colaborador</span>
          <select
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, userId: event.target.value || undefined }))
            }
            value={draftFilters.userId ?? ""}
          >
            <option value="">Toda a equipe</option>
            {dashboard?.team.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}{member.extension ? ` · Ramal ${member.extension}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Canal/provedor</span>
          <select
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, provider: event.target.value || undefined }))
            }
            value={draftFilters.provider ?? ""}
          >
            <option value="">Todos</option>
            <option value="directcall">DirectCall</option>
            <option value="twilio">Twilio</option>
            <option value="nvoip">Nvoip</option>
            <option value="wavoip">WhatsApp</option>
            <option value="internal">Interna</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Status</span>
          <select
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, status: event.target.value || undefined }))
            }
            value={draftFilters.status ?? ""}
          >
            <option value="">Todos</option>
            <option value="completed">Concluída</option>
            <option value="answered">Em andamento</option>
            <option value="failed">Falhou</option>
            <option value="no_answer">Não atendida</option>
            <option value="busy">Ocupado</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
        <div className={styles.filterActions}>
          <button className={styles.refresh} disabled={refreshing} type="submit">
            {refreshing ? "Aplicando..." : "Aplicar filtros"}
          </button>
          <button className={styles.clearButton} onClick={clearFilters} type="button">
            Limpar filtros
          </button>
        </div>
      </form>

      {error ? <div className={styles.error}>{error}</div> : null}
      {dashboard?.truncated ? (
        <div className={styles.warning}>
          O resultado excedeu 100.000 ligações. Refine o período para obter métricas e CSV completos.
        </div>
      ) : null}

      <div className={styles.dashboardMetrics} aria-label="Indicadores de telefonia">
        <article className={styles.dashboardMetricCard}>
          <span>Tempo médio de atendimento</span>
          <strong>{displayDuration(dashboard?.metrics.averageHandleTimeSeconds ?? null)}</strong>
          <small>Depende do fim do pós-atendimento</small>
        </article>
        <article className={styles.dashboardMetricCard}>
          <span>Total de ligações</span>
          <strong>{dashboard?.metrics.totalCalls ?? 0}</strong>
          <small>No período filtrado</small>
        </article>
        <article className={styles.dashboardMetricCard}>
          <span>Tempo total de conversação</span>
          <strong>{formatDuration(dashboard?.metrics.totalConversationSeconds ?? 0)}</strong>
          <small>Somente durações registradas</small>
        </article>
        <article className={styles.dashboardMetricCard}>
          <span>Tempo médio de conversação</span>
          <strong>{displayDuration(dashboard?.metrics.averageConversationSeconds ?? null)}</strong>
          <small>Somente chamadas com duração</small>
        </article>
        <article className={styles.dashboardMetricCard}>
          <span>Ligações concluídas</span>
          <strong>{dashboard?.metrics.completedCalls ?? 0}</strong>
          <small>Status concluída</small>
        </article>
        <article className={styles.dashboardMetricCard}>
          <span>Ligações com falha</span>
          <strong>{dashboard?.metrics.failedCalls ?? 0}</strong>
          <small>Falha, ocupado, não atendida ou cancelada</small>
        </article>
      </div>

      <section className={styles.card}>
        <div className={styles.chartHeading}>
          <div>
            <h3>Ligações ao longo do tempo</h3>
            <p>Entradas e saídas agrupadas conforme a visualização selecionada.</p>
          </div>
          <div className={styles.granularityTabs} aria-label="Agrupamento do gráfico">
            {GRANULARITIES.map((item) => (
              <button
                aria-pressed={filters.granularity === item.value}
                className={filters.granularity === item.value ? styles.granularityActive : ""}
                key={item.value}
                onClick={() => {
                  setDraftFilters((current) => ({ ...current, granularity: item.value }));
                  setFilters((current) => ({ ...current, granularity: item.value }));
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <CallsChart series={dashboard?.timeSeries ?? []} />
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeading}>
          <div>
            <h3>Ligações detalhadas</h3>
            <p>Resultado completo dos filtros, incluindo áudio e transcrição disponíveis.</p>
          </div>
          <span className={styles.count}>{dashboard?.items.length ?? 0}</span>
        </div>
        {dashboard?.items.length ? (
          <div className={`${styles.tableWrap} ${styles.dashboardTableWrap}`}>
            <table>
              <thead>
                <tr>
                  <th>Direção</th>
                  <th>Contato</th>
                  <th>Colaborador / ramal</th>
                  <th>Canal</th>
                  <th>Data e horário</th>
                  <th>Conversação</th>
                  <th>Até atendimento</th>
                  <th>Pós-atendimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.items.map((call) => {
                  const transcription = call.recording?.transcription;
                  const transcriptionReady =
                    transcription?.status === "completed" && Boolean(transcription.fullText);
                  const expanded = openTranscriptionCallId === call.id;
                  return (
                    <Fragment key={call.id}>
                      <tr>
                        <td>
                          <span className={styles.directionCell}>
                            <i className={call.direction === "inbound" ? styles.inboundIcon : styles.outboundIcon}>
                              {call.direction === "inbound" ? "↙" : "↗"}
                            </i>
                            {directionLabel(call.direction)}
                          </span>
                        </td>
                        <td>
                          <strong>{call.contactName ?? "Não identificado"}</strong>
                          <small>{call.contactNumber ?? "Não disponível"}</small>
                        </td>
                        <td>
                          <strong>{call.userName ?? "Não atribuída"}</strong>
                          <small>{call.extension ? `Ramal ${call.extension}` : "Sem ramal"}</small>
                        </td>
                        <td>{providerLabel(call.provider)}</td>
                        <td>{formatDate(call.startedAt)}</td>
                        <td>{displayDuration(call.durationSeconds)}</td>
                        <td>{displayDuration(call.answerTimeSeconds)}</td>
                        <td>{displayDuration(call.wrapUpTimeSeconds)}</td>
                        <td>
                          <span className={`${styles.status} ${statusClass(call.status)}`}>
                            {statusLabel(call.status)}
                          </span>
                        </td>
                        <td>
                          <div className={styles.tableActions}>
                            <button
                              className={styles.iconAction}
                              disabled={
                                call.recording?.status !== "available" ||
                                loadingRecordingId === call.recording.id
                              }
                              onClick={() =>
                                call.recording ? void playRecording(call.recording.id) : undefined
                              }
                              title={call.recording?.status === "available" ? "Ouvir gravação" : "Gravação não disponível"}
                              type="button"
                            >
                              {loadingRecordingId === call.recording?.id ? "…" : "▶"}
                            </button>
                            <button
                              className={styles.iconAction}
                              disabled={!transcriptionReady}
                              onClick={() => setOpenTranscriptionCallId(expanded ? null : call.id)}
                              title={transcriptionReady ? "Consultar transcrição" : "Transcrição não disponível"}
                              type="button"
                            >
                              ▤
                            </button>
                          </div>
                        </td>
                      </tr>
                      {audio && audio.recordingId === call.recording?.id ? (
                        <tr className={styles.detailRow}>
                          <td colSpan={10}>
                            <audio className={styles.dashboardAudio} autoPlay controls src={audio.url} />
                          </td>
                        </tr>
                      ) : null}
                      {expanded && transcription ? (
                        <tr className={styles.detailRow}>
                          <td colSpan={10}>
                            <div className={styles.dashboardTranscription}>
                              <strong>Transcrição da chamada</strong>
                              {transcription.segments?.length ? (
                                transcription.segments.map((segment) => (
                                  <p key={`${call.id}-${segment.index}`}>
                                    <b>{formatTimestamp(segment.startMs)}</b>
                                    <span>{segment.text}</span>
                                  </p>
                                ))
                              ) : (
                                <p>{transcription.fullText}</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>Nenhuma ligação encontrada</strong>
            <span>Altere os filtros ou escolha outro período.</span>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeading}>
          <div>
            <h3>Desempenho por colaborador</h3>
            <p>Consolidado da equipe para o mesmo período e filtros.</p>
          </div>
          <span className={styles.count}>{dashboard?.collaborators.length ?? 0}</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Ramal</th>
                <th>Ligações</th>
                <th>Concluídas</th>
                <th>Falhas</th>
                <th>Tempo total</th>
                <th>Média</th>
                <th>Gravações</th>
                <th>Transcrições</th>
                <th>Última ligação</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.collaborators.map((collaborator) => (
                <tr key={collaborator.userId}>
                  <td><strong>{collaborator.name}</strong><small>{collaborator.email}</small></td>
                  <td>{collaborator.extension ?? "—"}</td>
                  <td>{collaborator.calls}</td>
                  <td>{collaborator.completed}</td>
                  <td>{collaborator.failed}</td>
                  <td>{formatDuration(collaborator.durationSeconds)}</td>
                  <td>{displayDuration(collaborator.averageDurationSeconds)}</td>
                  <td>{collaborator.recordings}</td>
                  <td>{collaborator.transcriptions}</td>
                  <td>{formatDate(collaborator.lastCallAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
