import type { Priority, RoleId, StatusId } from "@/lib/types";
import { isStatus } from "@/lib/types";

export const ROLE_LABELS: Record<RoleId, string> = {
  administrator: "Amministratore",
  manager: "Manager",
  user: "Utente",
};

export const STATUS_LABELS: Record<StatusId, string> = {
  draft: "Bozza",
  new: "Nuovo",
  assigned: "Assegnato",
  accepted: "Preso in carico",
  wip: "In lavorazione",
  blocked: "Bloccato",
  completed: "Completato",
  closed: "Chiuso",
  cancelled: "Annullato",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Bassa",
  normal: "Normale",
  high: "Alta",
  critical: "Critica",
};

export const NOTIFICATION_LABELS: Record<string, string> = {
  assigned: "Assegnazione",
  accepted: "Presa in carico",
  status_changed: "Stato",
  comment: "Commento",
  updated: "Modifica",
  due_soon: "In scadenza",
  overdue: "Scaduto",
  completed: "Completato",
};

const QUICK: Partial<Record<StatusId, { status: StatusId; label: string }[]>> = {
  assigned: [
    { status: "accepted", label: "Prendi in carico" },
    { status: "wip", label: "Inizia" },
  ],
  accepted: [{ status: "wip", label: "Inizia" }],
  wip: [
    { status: "completed", label: "Completa" },
    { status: "blocked", label: "Blocca" },
  ],
  blocked: [{ status: "wip", label: "Riprendi" }],
  completed: [{ status: "closed", label: "Chiudi" }],
};

export function quickStatuses(status: StatusId): { status: StatusId; label: string }[] {
  return QUICK[status] ?? [];
}

export function historyText(action: string, detail: Record<string, unknown>): string {
  const statusLabel = (value: unknown) => (typeof value === "string" && isStatus(value) ? STATUS_LABELS[value] : "");
  const from = statusLabel(detail.from);
  const to = statusLabel(detail.to);
  const name = typeof detail.name === "string" ? detail.name : "";
  const fields = Array.isArray(detail.fields) ? detail.fields.filter((item): item is string => typeof item === "string") : [];
  const progress = typeof detail.progress === "number" ? detail.progress : Number(detail.progress);

  switch (action) {
    case "created":
      return "Ha creato il task";
    case "updated":
      return fields.length ? `Ha modificato: ${fields.join(", ")}` : "Ha modificato i dettagli";
    case "status_changed":
      return from && to ? `Ha cambiato lo stato da ${from} a ${to}` : "Ha cambiato lo stato";
    case "assigned":
      return name ? `Ha assegnato ${name}` : "Ha assegnato una persona";
    case "unassigned":
      return name ? `Ha rimosso ${name}` : "Ha rimosso un assegnatario";
    case "accepted":
      return "Ha preso in carico il task";
    case "commented":
      return "Ha aggiunto un commento";
    case "progress":
      return Number.isFinite(progress) ? `Ha aggiornato l'avanzamento al ${progress}%` : "Ha aggiornato l'avanzamento";
    default:
      return "Ha aggiornato il task";
  }
}
