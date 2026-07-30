"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";
import {
  api,
  type ConversationListItem,
  type Message,
  type ThreadResponse,
} from "@/lib/api-client";
import styles from "./inbox.module.css";

const STATUS_LABEL: Record<string, string> = {
  queued: "enviando",
  submitted: "enviada",
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
  received: "",
};

export default function InboxPage() {
  const { session, loading, logout } = useSession();
  const router = useRouter();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  const loadConversations = useCallback(async () => {
    if (!session) return;
    try {
      setConversations(await api.conversations(session.accessToken));
    } catch {
      setError("Não foi possível carregar as conversas.");
    }
  }, [session]);

  const loadThread = useCallback(
    async (conversationId: string) => {
      if (!session) return;
      try {
        setThread(await api.thread(session.accessToken, conversationId));
        await api.markRead(session.accessToken, conversationId).catch(() => undefined);
      } catch {
        setError("Não foi possível carregar a conversa.");
      }
    },
    [session],
  );

  useEffect(() => {
    void loadConversations();
    // Sem WebSocket ainda: a atualização em tempo real entra junto com o
    // gateway, na fase de telefonia.
    const timer = setInterval(() => void loadConversations(), 10000);
    return () => clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId) {
      void loadThread(selectedId);
    }
  }, [selectedId, loadThread]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [thread]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!session || !selectedId || !draft.trim()) return;

    setSending(true);
    setError(null);
    const texto = draft.trim();

    try {
      const message = await api.sendMessage(session.accessToken, selectedId, texto);
      setDraft("");
      // A API devolve a mensagem já persistida, inclusive quando o envio falhou:
      // o atendente vê a tentativa em vez de o texto desaparecer.
      setThread((current) =>
        current ? { ...current, messages: [...current.messages, message] } : current,
      );
      void loadConversations();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.includes("24 horas")
          ? "Fora da janela de 24 horas. É necessário um template aprovado."
          : "Não foi possível enviar a mensagem.",
      );
    } finally {
      setSending(false);
    }
  }

  if (loading || !session) {
    return <div className={styles.loading}>Carregando…</div>;
  }

  const selected = conversations.find((item) => item.id === selectedId);
  const withinWindow = thread?.conversation.withinServiceWindow ?? false;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>Omni Platform</span>
        <div className={styles.headerRight}>
          <span>{session.user.name}</span>
          <button
            className={styles.logout}
            type="button"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside
          className={`${styles.list} ${selectedId ? "" : styles.listVisible}`}
          aria-label="Conversas"
        >
          <div className={styles.listHeader}>Conversas ({conversations.length})</div>
          {conversations.length === 0 && (
            <div className={styles.empty}>Nenhuma conversa ainda.</div>
          )}
          {conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.item} ${item.id === selectedId ? styles.itemActive : ""}`}
              onClick={() => setSelectedId(item.id)}
              aria-current={item.id === selectedId}
            >
              <div className={styles.itemTop}>
                <span className={styles.itemName}>
                  {item.contactName ?? item.contactIdentifier ?? "Sem nome"}
                  {item.unreadCount > 0 && (
                    <span className={styles.badge}>{item.unreadCount}</span>
                  )}
                </span>
                <span className={styles.itemTime}>{formatTime(item.lastMessageAt)}</span>
              </div>
              <div className={styles.itemPreview}>
                {item.lastMessagePreview ?? "Sem mensagens"}
              </div>
            </button>
          ))}
        </aside>

        <section className={`${styles.thread} ${selectedId ? "" : styles.threadHidden}`}>
          {!selected || !thread ? (
            <div className={styles.empty}>Selecione uma conversa para começar.</div>
          ) : (
            <>
              <div className={styles.threadHeader}>
                <div>
                  <button
                    className={styles.back}
                    type="button"
                    onClick={() => setSelectedId(null)}
                  >
                    ← Voltar
                  </button>
                  <div className={styles.threadName}>
                    {selected.contactName ?? "Sem nome"}
                  </div>
                  <div className={styles.threadNumber}>{selected.contactIdentifier}</div>
                </div>
                <span
                  className={`${styles.window} ${
                    withinWindow ? styles.windowOpen : styles.windowClosed
                  }`}
                >
                  {withinWindow ? "Janela de 24h aberta" : "Janela de 24h encerrada"}
                </span>
              </div>

              <div className={styles.messages} ref={messagesRef}>
                {thread.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>

              {withinWindow ? (
                <form className={styles.composer} onSubmit={handleSend}>
                  <textarea
                    className={styles.input}
                    rows={2}
                    placeholder="Escreva uma mensagem…"
                    value={draft}
                    disabled={sending}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend(event);
                      }
                    }}
                  />
                  <button
                    className={styles.send}
                    type="submit"
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? "Enviando…" : "Enviar"}
                  </button>
                </form>
              ) : (
                <div className={styles.blocked} role="status">
                  Passaram-se mais de 24 horas desde a última mensagem do contato. Pelas
                  regras da Meta, só é possível retomar com um template aprovado.
                </div>
              )}

              {error && (
                <div className={styles.blocked} role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const failed = message.status === "failed";
  const className = failed
    ? styles.failed
    : message.direction === "inbound"
      ? styles.inbound
      : styles.outbound;

  return (
    <div className={`${styles.bubble} ${className}`}>
      {message.body ?? `[${message.contentType}]`}
      <div className={styles.meta}>
        <span>{formatTime(message.createdAt)}</span>
        {message.direction === "outbound" && (
          <span>{STATUS_LABEL[message.status] ?? message.status}</span>
        )}
        {failed && message.errorMessage && <span>· {message.errorMessage}</span>}
      </div>
    </div>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const hoje = new Date();
  const mesmoDia = date.toDateString() === hoje.toDateString();

  return mesmoDia
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
