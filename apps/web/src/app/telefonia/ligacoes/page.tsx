"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import {
  api,
  type TelephonyListResponse,
  type TelephonyOverview,
  type VoiceCall,
} from "@/lib/api-client";
import {
  formatDate,
  formatDuration,
  providerLabel,
  statusLabel,
  todayInSaoPaulo,
} from "../telephony-format";
import styles from "../telefonia.module.css";

function statusClass(status: string) {
  if (["completed", "answered"].includes(status)) return styles.statusGood;
  if (["failed", "busy", "no_answer", "cancelled"].includes(status)) {
    return styles.statusBad;
  }
  return styles.statusNeutral;
}

export default function CallsPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [date, setDate] = useState(todayInSaoPaulo);
  const [userId, setUserId] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [overview, setOverview] = useState<TelephonyOverview | null>(null);
  const [result, setResult] = useState<TelephonyListResponse<VoiceCall> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, router, session]);

  useEffect(() => {
    if (!session) return;
    void api.telephonyOverview(session.accessToken).then(setOverview).catch(() => null);
  }, [session]);

  const loadCalls = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      setResult(
        await api.telephonyCalls(session.accessToken, {
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
          : "Não foi possível carregar as ligações.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [date, provider, session, status, userId]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  if (loading || !session) {
    return <main className={styles.loading}>Carregando ligações...</main>;
  }

  const ownScope = result?.scope === "own" || session.user.roleKey === "agent";

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.content}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Histórico</p>
            <h1>{ownScope ? "Minhas ligações" : "Ligações da equipe"}</h1>
            <p className={styles.subtitle}>
              Consulte chamadas por dia, colaborador, canal e resultado.
            </p>
          </div>
          <Link className={styles.refresh} href="/telefonia">
            Voltar para telefonia
          </Link>
        </section>

        <section className={styles.filters} aria-label="Filtros de ligações">
          <label className={styles.filterField}>
            <span>Dia</span>
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
              <option value="internal">Interna</option>
            </select>
          </label>
          <label className={styles.filterField}>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos</option>
              <option value="completed">Concluída</option>
              <option value="failed">Falhou</option>
              <option value="no_answer">Não atendida</option>
              <option value="busy">Ocupado</option>
            </select>
          </label>
          <button className={styles.refresh} disabled={refreshing} onClick={() => void loadCalls()}>
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </section>

        {ownScope ? (
          <p className={styles.scopeNotice}>
            Você visualiza somente as chamadas vinculadas ao seu usuário e ao seu ramal.
          </p>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Resultado do dia</h2>
              <p>Chamadas recebidas e realizadas no período selecionado.</p>
            </div>
            <span className={styles.count}>{result?.items.length ?? 0}</span>
          </div>
          {result?.items.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Canal</th>
                    {!ownScope ? <th>Colaborador</th> : null}
                    <th>Ramal</th>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>Duração</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((call) => (
                    <tr key={call.id}>
                      <td>{formatDate(call.startedAt)}</td>
                      <td>{providerLabel(call.provider)}</td>
                      {!ownScope ? <td>{call.userName ?? "Não atribuída"}</td> : null}
                      <td>{call.extension ?? "—"}</td>
                      <td>{call.fromNumber ?? "—"}</td>
                      <td>{call.toNumber ?? "—"}</td>
                      <td>{formatDuration(call.durationSeconds)}</td>
                      <td>
                        <span className={`${styles.status} ${statusClass(call.status)}`}>
                          {statusLabel(call.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>Nenhuma ligação encontrada</strong>
              <span>Altere os filtros ou escolha outro dia.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
