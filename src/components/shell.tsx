"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ROLE_LABELS } from "@/lib/labels";
import type { RoleId, Stage } from "@/lib/types";

const LINKS: { href: string; label: string; admin?: boolean }[] = [
  { href: "/", label: "Panoramica" },
  { href: "/my-tasks", label: "I miei task" },
  { href: "/inbox", label: "Inbox" },
  { href: "/tasks", label: "Elenco" },
  { href: "/kanban", label: "Kanban" },
  { href: "/gantt", label: "Gantt" },
  { href: "/users", label: "Utenti", admin: true },
  { href: "/admin", label: "Amministrazione", admin: true },
];

export function Shell({
  orgName,
  name,
  role,
  unread,
  simulated,
  stage,
  children,
}: {
  orgName: string;
  name: string;
  role: RoleId;
  unread: number;
  simulated: boolean;
  stage: Stage;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div className="app-shell">
      <a className="skip" href="#contenuto">Vai al contenuto</a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="mark">A</span>
          <span>
            <strong>{orgName}</strong>
            <small>Task e responsabilità</small>
          </span>
        </Link>
        <nav className="nav" aria-label="Principale">
          {LINKS.filter((link) => !link.admin || role === "administrator").map((link) => (
            <Link className={active(link.href) ? "active" : undefined} href={link.href} key={link.href}>
              {link.label}
              {link.href === "/inbox" && unread > 0 ? <span className="count">{unread}</span> : null}
            </Link>
          ))}
        </nav>
        <Link className={active("/profile") ? "me active" : "me"} href="/profile">
          <span className="avatar" aria-hidden="true">{initials(name)}</span>
          <span>
            <strong>{name}</strong>
            <small>{ROLE_LABELS[role]}</small>
          </span>
        </Link>
      </aside>
      <div className="content">
        {simulated ? (
          <p className="banner">Accesso locale simulato: non è una sessione reale. Nell'app pubblicata l'identità arriva dall'account Cursor.</p>
        ) : null}
        {stage === "preview" ? (
          <p className="banner">Ambiente di anteprima: i dati sono separati da quelli di produzione.</p>
        ) : null}
        <div id="contenuto">{children}</div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}
