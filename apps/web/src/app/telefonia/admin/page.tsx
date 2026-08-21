"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import {
  api,
  type TelephonyCollaborator,
} from "@/lib/api-client";
import { TelephonyMetricsDashboard } from "./telephony-metrics-dashboard";
import styles from "../telefonia.module.css";

export default function TelephonyAdminPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [collaborators, setCollaborators] = useState<TelephonyCollaborator[]>([]);
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
    try {
      const collaboratorsResult = await api.telephonyCollaborators(
        session.accessToken,
      );
      setCollaborators(collaboratorsResult.items);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar o painel administrativo.",
      );
    }
  }, [session]);

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
              Acompanhe os indicadores da operação, a equipe e os ramais em um só lugar.
            </p>
          </div>
          <Link className={styles.refresh} href="/telefonia">
            Voltar para telefonia
          </Link>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}

        <TelephonyMetricsDashboard accessToken={session.accessToken} />

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

      </main>
    </div>
  );
}
