"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/components/session-provider";
import {
  type VoiceProvider,
  useSipPhone,
} from "@/components/use-sip-phone";
import {
  api,
  type DialerCampaign,
  type DialerCampaignItem,
  type DialerContact,
} from "@/lib/api-client";
import styles from "./discador.module.css";

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
] as const;

const PROVIDERS: Array<{ value: VoiceProvider; label: string }> = [
  { value: "twilio", label: "Telefone — Twilio" },
  { value: "directcall", label: "Telefone — DirectCall" },
  { value: "wavoip", label: "Voz pelo WhatsApp" },
];

const DISPOSITIONS = [
  ["answered", "Atendido"],
  ["sale", "Venda realizada"],
  ["callback", "Retornar depois"],
  ["not_interested", "Sem interesse"],
  ["no_answer", "Não atendeu"],
  ["busy", "Ocupado"],
  ["invalid", "Número inválido"],
] as const;

function phoneStatusLabel(status: string) {
  return {
    connecting: "Conectando",
    ready: "Disponível",
    calling: "Chamando",
    incoming: "Recebendo chamada",
    active: "Em ligação",
    offline: "Offline",
    error: "Erro",
  }[status] ?? status;
}

function campaignStatusLabel(status: DialerCampaign["status"]) {
  return {
    draft: "Rascunho",
    active: "Ativa",
    paused: "Pausada",
    completed: "Concluída",
  }[status];
}

export default function DialerPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [provider, setProvider] = useState<VoiceProvider>("twilio");
  const [contacts, setContacts] = useState<DialerContact[]>([]);
  const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [activeItem, setActiveItem] = useState<DialerCampaignItem | null>(null);
  const [disposition, setDisposition] = useState("answered");
  const [notes, setNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignProvider, setCampaignProvider] = useState<DialerCampaign["provider"]>("twilio");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const onCallEnded = useCallback(() => {
    setMessage("Ligação encerrada. Registre o resultado para liberar o próximo contato.");
  }, []);
  const phone = useSipPhone(session?.accessToken, onCallEnded);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, router, session]);

  const loadDialer = useCallback(async () => {
    if (!session) return;
    try {
      const [contactResult, campaignResult] = await Promise.all([
        api.dialerContacts(session.accessToken),
        api.dialerCampaigns(session.accessToken),
      ]);
      setContacts(contactResult.items);
      setCampaigns(campaignResult.items);
      setSelectedCampaignId((current) =>
        current || campaignResult.items.find((item) => item.status === "active")?.id || "",
      );
      setPageError(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Não foi possível carregar o discador.");
    }
  }, [session]);

  useEffect(() => {
    void loadDialer();
  }, [loadDialer]);

  const canManageCampaigns = session?.user.roleKey !== "agent";
  const selectedCampaign = useMemo(
    () => campaigns.find((item) => item.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );
  const callInProgress = ["calling", "incoming", "active"].includes(phone.status);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setPageError(null);
    try {
      await action();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "A operação não pôde ser concluída.");
    } finally {
      setBusy(false);
    }
  };

  const pressKey = (key: string) => {
    if (phone.status === "active") {
      void phone.sendDTMF(key);
      setMessage(`Tom ${key} enviado.`);
      return;
    }
    setPhoneNumber((current) => `${current}${key}`);
  };

  const createContact = () => run(async () => {
    if (!session) return;
    await api.createDialerContact(session.accessToken, {
      name: contactName,
      phoneNumber: contactPhone,
      company: contactCompany || undefined,
    });
    setContactName("");
    setContactPhone("");
    setContactCompany("");
    setMessage("Contato cadastrado.");
    await loadDialer();
  });

  const createCampaign = () => run(async () => {
    if (!session) return;
    await api.createDialerCampaign(session.accessToken, {
      name: campaignName,
      provider: campaignProvider,
      contactIds: selectedContacts,
    });
    setCampaignName("");
    setSelectedContacts([]);
    setMessage("Campanha criada como rascunho.");
    await loadDialer();
  });

  const updateCampaign = (status: DialerCampaign["status"]) => run(async () => {
    if (!session || !selectedCampaign) return;
    await api.setDialerCampaignStatus(session.accessToken, selectedCampaign.id, status);
    setMessage(`Campanha ${campaignStatusLabel(status).toLowerCase()}.`);
    await loadDialer();
  });

  const claimNext = () => run(async () => {
    if (!session || !selectedCampaign) return;
    const result = await api.claimNextDialerItem(session.accessToken, selectedCampaign.id);
    setActiveItem(result.item);
    if (!result.item) {
      setMessage("Não há mais contatos pendentes nesta campanha.");
      return;
    }
    setPhoneNumber(result.item.phoneNumber);
    setProvider(result.item.provider);
    setDisposition("answered");
    setNotes("");
    setMessage("Contato atribuído. Confira o número e clique em ligar.");
    await loadDialer();
  });

  const finishItem = () => run(async () => {
    if (!session || !activeItem) return;
    const failed = ["no_answer", "busy", "invalid"].includes(disposition);
    await api.completeDialerItem(session.accessToken, activeItem.id, {
      status: failed ? "failed" : "completed",
      disposition,
      notes: notes || undefined,
    });
    setActiveItem(null);
    setPhoneNumber("");
    setNotes("");
    setMessage("Resultado salvo. O próximo contato já pode ser solicitado.");
    await loadDialer();
  });

  if (loading || !session) {
    return <main className={styles.loading}>Carregando discador...</main>;
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.content}>
        <header className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Operação de voz</p>
            <h1>Discador</h1>
            <p>Faça chamadas, consulte contatos e trabalhe filas progressivas.</p>
          </div>
          <Link className={styles.secondaryButton} href="/telefonia">Voltar para telefonia</Link>
        </header>

        {pageError || phone.error ? <div className={styles.error}>{pageError || phone.error}</div> : null}
        {message ? <div className={styles.message}>{message}</div> : null}

        <section className={styles.workspace}>
          <article className={styles.phoneCard}>
            <div className={styles.phoneHeader}>
              <div>
                <span className={styles.phoneDot} data-state={phone.status} />
                <strong>{phoneStatusLabel(phone.status)}</strong>
              </div>
              <span>Ramal WebRTC</span>
            </div>
            <label className={styles.field}>
              <span>Canal</span>
              <select value={provider} disabled={callInProgress} onChange={(event) => setProvider(event.target.value as VoiceProvider)}>
                {PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className={styles.numberBox}>
              <input
                aria-label="Número para ligar"
                placeholder="(11) 99999-9999"
                value={phoneNumber}
                disabled={callInProgress}
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
              {!callInProgress && phoneNumber ? <button type="button" onClick={() => setPhoneNumber((current) => current.slice(0, -1))}>⌫</button> : null}
            </div>
            <div className={styles.keypad} aria-label="Teclado telefônico">
              {KEYS.map(([key, letters]) => (
                <button key={key} type="button" onClick={() => pressKey(key)}>
                  <strong>{key}</strong><small>{letters}</small>
                </button>
              ))}
            </div>
            <div className={styles.callControls}>
              {phone.status === "incoming" ? <button className={styles.callButton} onClick={() => void phone.answer()}>Atender</button> : null}
              {!callInProgress ? (
                <button className={styles.callButton} disabled={phone.status !== "ready" || !phoneNumber} onClick={() => void phone.call(phoneNumber, provider)}>Ligar</button>
              ) : (
                <button className={styles.hangupButton} onClick={() => void phone.hangup()}>Encerrar</button>
              )}
            </div>
            {phone.status === "active" ? (
              <div className={styles.liveControls}>
                <button className={phone.muted ? styles.activeControl : ""} onClick={phone.toggleMute}>{phone.muted ? "Ativar microfone" : "Mudo"}</button>
                <button className={phone.held ? styles.activeControl : ""} onClick={() => void phone.toggleHold()}>{phone.held ? "Retomar" : "Espera"}</button>
              </div>
            ) : null}
            <audio ref={phone.remoteAudioRef} autoPlay />
          </article>

          <div className={styles.sideColumn}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><h2>Contato da vez</h2><p>Discagem progressiva: um contato por atendente.</p></div>
              </div>
              {activeItem ? (
                <div className={styles.activeContact}>
                  <h3>{activeItem.contactName || "Contato sem nome"}</h3>
                  <p>{activeItem.company || "Sem empresa"}</p>
                  <button className={styles.phoneLink} onClick={() => setPhoneNumber(activeItem.phoneNumber)}>{activeItem.phoneNumber}</button>
                  <label className={styles.field}><span>Resultado</span><select value={disposition} onChange={(event) => setDisposition(event.target.value)}>{DISPOSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className={styles.field}><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resumo da conversa ou próximo passo" /></label>
                  <button className={styles.primaryButton} disabled={busy || callInProgress} onClick={() => void finishItem()}>Salvar resultado</button>
                </div>
              ) : (
                <div className={styles.emptyState}>Selecione uma campanha ativa e solicite o próximo contato.</div>
              )}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeading}><div><h2>Campanhas</h2><p>Fila compartilhada com acompanhamento em tempo real.</p></div></div>
              <div className={styles.campaignControls}>
                <select value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)}>
                  <option value="">Selecione uma campanha</option>
                  {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaignStatusLabel(campaign.status)}</option>)}
                </select>
                <button className={styles.primaryButton} disabled={busy || !selectedCampaign || selectedCampaign.status !== "active" || Boolean(activeItem)} onClick={() => void claimNext()}>Próximo contato</button>
              </div>
              {selectedCampaign ? (
                <div className={styles.metrics}>
                  <span><strong>{selectedCampaign.metrics.total}</strong>Total</span>
                  <span><strong>{selectedCampaign.metrics.pending}</strong>Pendentes</span>
                  <span><strong>{selectedCampaign.metrics.completed}</strong>Concluídos</span>
                  <span><strong>{selectedCampaign.metrics.failed}</strong>Falhas</span>
                </div>
              ) : null}
              {canManageCampaigns && selectedCampaign ? (
                <div className={styles.inlineActions}>
                  {selectedCampaign.status !== "active" ? <button onClick={() => void updateCampaign("active")}>Iniciar</button> : <button onClick={() => void updateCampaign("paused")}>Pausar</button>}
                  <button onClick={() => void updateCampaign("completed")}>Concluir</button>
                </div>
              ) : null}
            </article>
          </div>
        </section>

        <section className={styles.lowerGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Contatos</h2><p>Clique no telefone para preencher o discador.</p></div><span>{contacts.length}</span></div>
            <div className={styles.contactForm}>
              <input placeholder="Nome" value={contactName} onChange={(event) => setContactName(event.target.value)} />
              <input placeholder="Telefone com DDD" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
              <input placeholder="Empresa (opcional)" value={contactCompany} onChange={(event) => setContactCompany(event.target.value)} />
              <button className={styles.primaryButton} disabled={busy || contactName.trim().length < 2 || contactPhone.length < 10} onClick={() => void createContact()}>Adicionar</button>
            </div>
            <div className={styles.contactList}>
              {contacts.map((contact) => (
                <div key={contact.id} className={styles.contactRow}>
                  <div><strong>{contact.name || "Sem nome"}</strong><span>{contact.company || "Contato"}</span></div>
                  <button onClick={() => setPhoneNumber(contact.phoneNumber)}>{contact.phoneNumber}</button>
                  {canManageCampaigns ? <input aria-label={`Selecionar ${contact.name || contact.phoneNumber}`} type="checkbox" checked={selectedContacts.includes(contact.id)} onChange={(event) => setSelectedContacts((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} /> : null}
                </div>
              ))}
            </div>
          </article>

          {canManageCampaigns ? (
            <article className={styles.panel}>
              <div className={styles.panelHeading}><div><h2>Nova campanha</h2><p>Selecione os contatos na lista ao lado.</p></div></div>
              <label className={styles.field}><span>Nome</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex.: Retorno de propostas" /></label>
              <label className={styles.field}><span>Canal</span><select value={campaignProvider} onChange={(event) => setCampaignProvider(event.target.value as DialerCampaign["provider"])}>{PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <p className={styles.selectionCount}>{selectedContacts.length} contato(s) selecionado(s)</p>
              <button className={styles.primaryButton} disabled={busy || campaignName.trim().length < 2 || selectedContacts.length === 0} onClick={() => void createCampaign()}>Criar campanha</button>
              <p className={styles.transferNote}><strong>Transferência:</strong> prevista para a próxima etapa, após validar o fluxo SIP do provedor. Os controles de mudo, espera e DTMF já são reais.</p>
            </article>
          ) : null}
        </section>
      </main>
    </div>
  );
}
