"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type SessionUser } from "@/lib/api-client";

interface Session {
  accessToken: string;
  organizationId: string;
  user: SessionUser;
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * O access token fica apenas em memória, nunca em localStorage: ali ele seria
 * legível por qualquer script e exfiltrável em um XSS. A continuidade da sessão
 * entre recarregamentos vem do cookie httpOnly do refresh token, que o
 * JavaScript não alcança.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .refresh()
      .then((result) => {
        if (!cancelled) {
          setSession(result);
        }
      })
      .catch(() => {
        // Sem sessão anterior é o caso normal na primeira visita.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setSession(await api.login(email, password));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, login, logout }),
    [session, loading, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession precisa estar dentro de SessionProvider");
  }
  return context;
}
