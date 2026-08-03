"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import {
  api,
  type TelephonyCollaborator,
  type TelephonyDailyAdmin,
} from "@/lib/api-client";
import { formatDate, formatDuration, todayInSaoPaulo } from "../telephony-format";
import styles from "../telefonia.module.css";

export default function TelephonyAdminPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [date, setDate] = useState(todayInSaoPaulo);
  const [daily, setDaily] = useState<TelephonyDailyAdmin | null>(null);
  const [collaborators, setCollaborators] = useState<TelephonyCollaborator[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    roleKey: "agent" as "agent" | "supervisor",
    extension: "",
  });

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
    if (!loading && session && session.user.roleKey !== "admin") {
      router.replace("/telefonia");
    }
  }, [loading, router, session]);

  const loadDaily = useCallback(async () => {
    if (!session || session.user.roleKey !== "admin") return;
    setRefreshing(true);
    try {
      const [dailyResult, collaboratorsResult] = await Promise.all([
        api.telephonyDailyAdmin(session.accessToken, date),
        api.telephonyCollaborators(session.accessToken),
      ]);
      setDaily(dailyResult);
      setCollaborators(collaboratorsResult.items);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar o painel administrativo.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [date, session]);

  useEffect(() => {
    void loadDaily();
  }, [loadDaily]);

  const createCollaborator = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createTelephonyCollaborator(session.accessToken, {
        name: form.name,
        email: form.email,
        password: form.password,
        roleKey: form.roleKey,
        extension: form.extension || undefined,
      });
      setForm({
        name: "",
        email: "",
        password: "",
        roleKey: "agent",
        extension: "",
      });
      await loadDaily();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Não foi possível criar o colaborador.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const setCollaboratorActive = async (
    collaborator: TelephonyCollaborator,
    active: boolean,
  ) => {
    if (!session) return;
    setChangingUserId(collaborator.userId);
    setError(null);
    try {
      await api.setTelephonyCollaboratorStatus(
        session.accessToken,
        collaborator.userId,
        active,
      );
      await loadDaily();
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Não foi possível alterar o colaborador.",
      );
    } finally {
      setChangingUserId(null);
    }
  };

  if (loading || !session || session.user.roleKey !== "admin") {
    return <main className={styles.loading}>Verificando acesso...</main>;
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.content}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Gestão da operação</p>
            <h1>Painel administrativo</h1>
            <p className={styles.subtitle}>
              Acompanhe o resultado diário de todos os colaboradores e ramais.
            </p>
          </div>
          <Link className={styles.refresh} href="/telefonia">
            Voltar para telefonia
          </Link>
        </section>

        <section className={styles.filters} aria-label="Período do painel">
          <label className={styles.filterField}>
            <span>Dia da operação</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button
            className={styles.refresh}
            disabled={refreshing}
            onClick={() => void loadDaily()}
            type="button"
          >
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.managementGrid}>
          <form className={styles.card} onSubmit={createCollaborator}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Novo colaborador</h2>
                <p>Crie o acesso e atribua automaticamente o próximo ramal livre.</p>
              </div>
            </div>
            <div className={styles.adminForm}>
              <label className={styles.filterField}>
                <span>Nome</span>
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className={styles.filterField}>
                <span>E-mail</span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label className={styles.filterField}>
                <span>Senha inicial</span>
                <input
                  minLength={8}
                  required
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <label className={styles.filterField}>
                <span>Perfil</span>
                <select
                  value={form.roleKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      roleKey: event.target.value as "agent" | "supervisor",
                    }))
                  }
                >
                  <option value="agent">Atendente</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </label>
              <label className={styles.filterField}>
                <span>Ramal opcional</span>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  placeholder="Automático"
                  value={form.extension}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      extension: event.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </label>
              <button className={styles.callButton} disabled={submitting} type="submit">
                {submitting ? "Criando..." : "Criar colaborador"}
              </button>
            </div>
          </form>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Equipe e ramais</h2>
                <p>Contas, perfis e disponibilidade para receber chamadas.</p>
              </div>
              <span className={styles.count}>{collaborators.length}</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Perfil</th>
                    <th>Ramal</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {collaborators.map((collaborator) => (
                    <tr key={collaborator.userId}>
                      <td>
                        <strong>{collaborator.name}</strong>
                        <small>{collaborator.email}</small>
                      </td>
                      <td>{collaborator.role}</td>
                      <td>{collaborator.extension ?? "—"}</td>
                      <td>
                        <span
                          className={`${styles.status} ${
                            collaborator.active ? styles.statusGood : styles.statusBad
                          }`}
                        >
                          {collaborator.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <button
                          className={styles.listenButton}
                          disabled={
                            changingUserId === collaborator.userId ||
                            collaborator.userId === session.user.id
                          }
                          onClick={() =>
                            void setCollaboratorActive(collaborator, !collaborator.active)
                          }
                          type="button"
                        >
                          {collaborator.active ? "Desativar" : "Reativar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className={styles.metrics} aria-label="Resumo do dia">
          <article className={styles.metricCard}>
            <span>Colaboradores</span>
            <strong className={styles.metricValue}>{daily?.summary.teamMembers ?? 0}</strong>
            <small>Usuários ativos na organização</small>
          </article>
          <article className={styles.metricCard}>
            <span>Ligações</span>
            <strong className={styles.metricValue}>{daily?.summary.calls ?? 0}</strong>
            <small>{daily?.summary.completed ?? 0} concluídas</small>
          </article>
          <article className={styles.metricCard}>
            <span>Falhas</span>
            <strong className={styles.metricValue}>{daily?.summary.failed ?? 0}</strong>
            <small>Não atendidas, ocupadas ou canceladas</small>
          </article>
          <article className={styles.metricCard}>
            <span>Tempo em chamada</span>
            <strong className={styles.metricValue}>
              {formatDuration(daily?.summary.durationSeconds ?? 0)}
            </strong>
            <small>Duração total no dia</small>
          </article>
          <article className={styles.metricCard}>
            <span>Gravações</span>
            <strong className={styles.metricValue}>{daily?.summary.recordings ?? 0}</strong>
            <small>Arquivos associados às chamadas</small>
          </article>
          <article className={styles.metricCard}>
            <span>Transcrições</span>
            <strong className={styles.metricValue}>
              {daily?.summary.transcriptions ?? 0}
            </strong>
            <small>Processamentos concluídos</small>
          </article>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Desempenho por colaborador</h2>
              <p>Consolidado do dia selecionado, incluindo colaboradores sem chamadas.</p>
            </div>
            <span className={styles.count}>{daily?.collaborators.length ?? 0}</span>
          </div>
          {daily?.collaborators.length ? (
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
                  {daily.collaborators.map((collaborator) => (
                    <tr key={collaborator.userId}>
                      <td>
                        <strong>{collaborator.name}</strong>
                        <small>{collaborator.email}</small>
                      </td>
                      <td>{collaborator.extension ?? "—"}</td>
                      <td>{collaborator.calls}</td>
                      <td>{collaborator.completed}</td>
                      <td>{collaborator.failed}</td>
                      <td>{formatDuration(collaborator.durationSeconds)}</td>
                      <td>{formatDuration(collaborator.averageDurationSeconds)}</td>
                      <td>{collaborator.recordings}</td>
                      <td>{collaborator.transcriptions}</td>
                      <td>{formatDate(collaborator.lastCallAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>Nenhum colaborador ativo</strong>
              <span>Não há usuários para consolidar neste dia.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
