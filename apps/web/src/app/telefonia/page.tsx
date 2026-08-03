"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import { useSipPhone, type VoiceProvider } from "@/components/use-sip-phone";
import { api, type TelephonyOverview, type TelephonyTeamMember } from "@/lib/api-client";
import styles from "./telefonia.module.css";

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Desconhecido",
  unassigned: "Sem ramal",
  connecting: "Conectando",
  ready: "Online",
  calling: "Chamando",
  incoming: "Recebendo",
  active: "Em ligação",
  error: "Erro",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function statusClass(status: string) {
  if (["online", "active", "ready"].includes(status)) return styles.statusGood;
  if (["offline", "error"].includes(status)) return styles.statusBad;
  return styles.statusNeutral;
}

function memberEndpoint(member: TelephonyTeamMember) {
  return member.extension ? `Ramal ${member.extension}` : "Não configurado";
}

function isPhoneOnline(status: string) {
  return ["ready", "calling", "incoming", "active"].includes(status);
}

export default function TelephonyPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [overview, setOverview] = useState<TelephonyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("directcall");

  const loadOverview = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      setOverview(await api.telephonyOverview(session.accessToken));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar a telefonia.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [session]);

  const phone = useSipPhone(session?.accessToken, loadOverview);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, router, session]);

  useEffect(() => {
    if (!session) return;
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 5_000);
    return () => window.clearInterval(interval);
  }, [loadOverview, session]);

  const myExtension = useMemo(
    () => overview?.team.find((member) => member.userId === session?.user.id),
    [overview, session?.user.id],
  );

  const phoneBusy = ["calling", "incoming", "active"].includes(phone.status);
  const phoneOnline = isPhoneOnline(phone.status);
  const apiOwnExtensionOnline = myExtension?.endpointStatus === "online";
  const visibleOnlineExtensions = Math.max(
    0,
    (overview?.summary.onlineExtensions ?? 0) +
      (myExtension && phoneOnline && !apiOwnExtensionOnline
        ? 1
        : myExtension &&
            !phoneOnline &&
            apiOwnExtensionOnline &&
            ["offline", "error"].includes(phone.status)
          ? -1
          : 0),
  );
  const phoneAction =
    phone.status === "incoming"
      ? { label: "Atender", action: phone.answer, destructive: false }
      : phone.status === "calling" || phone.status === "active"
        ? { label: "Desligar", action: phone.hangup, destructive: true }
        : {
            label: phone.status === "connecting" ? "Conectando..." : "Ligar",
            action: () => phone.call(phoneNumber, voiceProvider),
            destructive: false,
          };
  const phoneActionEnabled = ["ready", "calling", "incoming", "active"].includes(
    phone.status,
  );

  if (loading || !session) {
    return <main className={styles.loading}>Carregando telefonia...</main>;
  }

  const ownScope = overview?.scope === "own" || session.user.roleKey === "agent";

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.content}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Operação de voz</p>
            <h1>Telefonia</h1>
            <p className={styles.subtitle}>
              Use seu ramal para ligar e acompanhe o estado da infraestrutura SIP.
            </p>
          </div>
          <button
            className={styles.refresh}
            disabled={refreshing}
            onClick={() => void loadOverview()}
            type="button"
          >
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.metrics} aria-label="Resumo da telefonia">
          <article className={styles.metricCard}>
            <span>Troncos SIP</span>
            <div className={styles.trunkList}>
              {overview?.asterisk.trunks.map((trunk) => (
                <div className={styles.trunkRow} key={trunk.endpoint}>
                  <strong>{trunk.label}</strong>
                  <span className={`${styles.status} ${statusClass(trunk.status)}`}>
                    {statusLabel(trunk.status)}
                  </span>
                </div>
              ))}
            </div>
            <strong>
              {overview?.asterisk.available ? "Conectado ao Asterisk" : "Indisponível"}
            </strong>
            <small>
              {overview?.asterisk.version
                ? `Asterisk ${overview.asterisk.version}`
                : "Aguardando resposta do servidor"}
            </small>
          </article>

          <article className={styles.metricCard}>
            <span>{ownScope ? "Suas ligações agora" : "Ligações agora"}</span>
            <strong className={styles.metricValue}>{overview?.summary.activeCalls ?? 0}</strong>
            <small>{overview?.asterisk.activeChannels ?? 0} canais ativos</small>
          </article>

          <article className={styles.metricCard}>
            <span>{ownScope ? "Seu ramal online" : "Ramais online"}</span>
            <strong className={styles.metricValue}>
              {visibleOnlineExtensions}/{overview?.summary.teamMembers ?? 0}
            </strong>
            <small>Atualização automática a cada 5 segundos</small>
          </article>

          <article className={styles.metricCard}>
            <span>Gravações recentes</span>
            <strong className={styles.metricValue}>{overview?.summary.recordings ?? 0}</strong>
            <small>{ownScope ? "Somente das suas chamadas" : "Visíveis para supervisão"}</small>
          </article>
        </section>

        <section className={`${styles.grid} ${ownScope ? styles.singleColumn : ""}`}>
          <article className={`${styles.card} ${styles.dialerCard}`}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Seu ramal</h2>
                <p>Identificação usada para atribuir ligações e gravações.</p>
              </div>
              <span
                className={`${styles.status} ${statusClass(
                  myExtension ? phone.status : "unassigned",
                )}`}
              >
                {statusLabel(myExtension ? phone.status : "unassigned")}
              </span>
            </div>
            <div className={styles.extensionValue}>
              {myExtension?.extension ?? "Sem ramal"}
            </div>
            <p className={styles.extensionCaption}>
              {myExtension
                ? `Endpoint PJSIP ${myExtension.endpointId}`
                : "Peça ao administrador para atribuir um ramal."}
            </p>
            <label className={styles.phoneLabel} htmlFor="voice-provider">
              Canal da ligação
            </label>
            <select
              className={styles.providerSelect}
              disabled={!myExtension || phoneBusy}
              id="voice-provider"
              value={voiceProvider}
              onChange={(event) => setVoiceProvider(event.target.value as VoiceProvider)}
            >
              <option value="directcall">Telefone — DirectCall</option>
              <option value="wavoip">WhatsApp — WaVoIP</option>
            </select>
            <label className={styles.phoneLabel} htmlFor="phone-number">
              Número para ligar
            </label>
            <div className={styles.dialRow}>
              <input
                className={styles.phoneInput}
                disabled={!myExtension || phoneBusy}
                id="phone-number"
                placeholder="(11) 99999-9999"
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
              <button
                className={`${styles.callButton} ${
                  phoneAction.destructive ? styles.hangupButton : ""
                }`}
                disabled={!phoneActionEnabled}
                onClick={() => void phoneAction.action()}
                type="button"
              >
                {phoneAction.label}
              </button>
            </div>
            <audio ref={phone.remoteAudioRef} autoPlay className={styles.hiddenAudio} />
            {phone.error ? <p className={styles.phoneError}>{phone.error}</p> : null}
            <p className={styles.notice}>
              {phone.status === "ready"
                ? "Ramal conectado. A gravação começa automaticamente quando a chamada é atendida."
                : phone.status === "active"
                  ? "Ligação em andamento e gravação ativa no Asterisk."
                  : phone.status === "incoming"
                    ? "Há uma ligação recebida aguardando atendimento."
                    : "Conectando o ramal ao Asterisk. Na primeira ligação, permita o acesso ao microfone."}
            </p>
          </article>

          {!ownScope ? (
            <article className={styles.card}>
              <div className={styles.cardHeading}>
                <div>
                  <h2>Colaboradores e ramais</h2>
                  <p>Veja quem está apto a realizar ligações.</p>
                </div>
                <span className={styles.count}>{overview?.team.length ?? 0}</span>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Função</th>
                      <th>Ramal</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.team.map((member) => (
                      <tr key={member.userId}>
                        <td>
                          <strong>{member.name}</strong>
                          <small>{member.email}</small>
                        </td>
                        <td>{member.role}</td>
                        <td>{memberEndpoint(member)}</td>
                        <td>
                          <span
                            className={`${styles.status} ${statusClass(
                              member.userId === session.user.id
                                ? phone.status
                                : member.endpointStatus,
                            )}`}
                          >
                            {statusLabel(
                              member.userId === session.user.id
                                ? phone.status
                                : member.endpointStatus,
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}
        </section>

        <section className={styles.shortcuts} aria-label="Atalhos de telefonia">
          <Link className={styles.shortcutCard} href="/telefonia/ligacoes">
            <strong>{ownScope ? "Minhas ligações" : "Histórico de ligações"}</strong>
            <span>Filtrar por dia, colaborador, canal e status.</span>
          </Link>
          <Link className={styles.shortcutCard} href="/telefonia/gravacoes">
            <strong>{ownScope ? "Minhas gravações" : "Gravações e transcrições"}</strong>
            <span>Ouvir o áudio e consultar o texto transcrito.</span>
          </Link>
          {session.user.roleKey === "admin" ? (
            <Link className={styles.shortcutCard} href="/telefonia/admin">
              <strong>Painel administrativo</strong>
              <span>Acompanhar o dia de todos os colaboradores.</span>
            </Link>
          ) : null}
        </section>
      </main>
    </div>
  );
}
