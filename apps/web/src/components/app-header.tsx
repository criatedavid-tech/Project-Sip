"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./session-provider";
import styles from "./app-header.module.css";

const NAVIGATION = [
  { href: "/inbox", label: "Conversas" },
  { href: "/telefonia", label: "Telefonia" },
  { href: "/telefonia/discador", label: "Discador" },
  { href: "/telefonia/ligacoes", label: "Ligações" },
  { href: "/telefonia/gravacoes", label: "Gravações" },
  { href: "/telefonia/admin", label: "Painel admin", adminOnly: true },
];

function navigationIsActive(pathname: string, href: string) {
  return href === "/telefonia"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const { session, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (!session) return null;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <Link className={styles.brand} href="/inbox">
          Omni Platform
        </Link>
        <nav className={styles.navigation} aria-label="Navegação principal">
          {NAVIGATION.filter(
            (item) => !item.adminOnly || session.user.roleKey === "admin",
          ).map((item) => (
            <Link
              className={`${styles.navLink} ${
                navigationIsActive(pathname, item.href) ? styles.navLinkActive : ""
              }`}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className={styles.right}>
        <span className={styles.identity}>{session.user.name}</span>
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
  );
}
