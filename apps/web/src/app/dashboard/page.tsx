"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { api } from "@/lib/api-client";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  const { session, loading, logout } = useSession();
  const router = useRouter();
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    api
      .me(session.accessToken)
      .then((result) => {
        if (!cancelled) {
          setPermissions(result.permissions);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading || !session) {
    return <div className={styles.loading}>Carregando…</div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>Omni Platform</span>
        <div className={styles.headerRight}>
          <div className={styles.identity}>
            <div>{session.user.name}</div>
            <div>{session.user.email}</div>
          </div>
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

      <main className={styles.content}>
        <h1 className={styles.title}>Sessão ativa</h1>
        <p className={styles.subtitle}>
          Fundação da plataforma. Os canais de WhatsApp e telefonia entram nas
          próximas fases.
        </p>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Identificação</h2>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={styles.rowLabel}>Perfil</dt>
              <dd className={styles.rowValue}>{session.user.roleKey}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.rowLabel}>Organização</dt>
              <dd className={styles.rowValue}>{session.organizationId}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.rowLabel}>Usuário</dt>
              <dd className={styles.rowValue}>{session.user.id}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Permissões ({permissions.length})</h2>
          <div className={styles.tags}>
            {permissions.map((permission) => (
              <span className={styles.tag} key={permission}>
                {permission}
              </span>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
