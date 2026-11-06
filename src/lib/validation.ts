import { AppError } from "@/lib/errors";
import type { Priority, RoleId, StatusId, TaskInput } from "@/lib/types";
import { isPriority, isRole, isStatus } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return UUID.test(text) ? text : null;
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function cleanBounded(value: unknown, max: number, label: string, line = false): string {
  if (typeof value !== "string") throw new AppError(`${label} non è valido.`);
  let text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (line) text = text.replace(/\s+/g, " ");
  text = text.trim();
  if (text.length > max) throw new AppError(`${label} può avere al massimo ${max} caratteri.`);
  return text;
}

export function parseDateField(value: string, label: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new AppError(`${label} non è una data valida.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AppError(`${label} non è una data valida.`);
  }
  return text;
}

export function parseProgress(value: string): number {
  const text = value.trim();
  if (text === "") return 0;
  if (!/^\d{1,3}$/.test(text)) throw new AppError("L'avanzamento deve essere un intero tra 0 e 100.");
  const progress = Number(text);
  if (progress > 100) throw new AppError("L'avanzamento deve essere un intero tra 0 e 100.");
  return progress;
}

export function parseTaskForm(form: FormData): TaskInput {
  const title = cleanBounded(field(form, "title"), 200, "Il titolo", true);
  if (!title) throw new AppError("Il titolo è obbligatorio.");
  const description = cleanBounded(field(form, "description"), 8000, "La descrizione");
  const priorityRaw = field(form, "priority").trim();
  if (!isPriority(priorityRaw)) throw new AppError("La priorità non è valida.");
  const statusRaw = field(form, "status").trim();
  if (!isStatus(statusRaw)) throw new AppError("Lo stato non è valido.");
  const groupId = parseUuid(field(form, "groupId"));
  if (!groupId) throw new AppError("Il gruppo non è valido.");
  const plannedStart = parseDateField(field(form, "plannedStart"), "La data di inizio");
  const deadline = parseDateField(field(form, "deadline"), "La scadenza");
  if (plannedStart && deadline && deadline < plannedStart) {
    throw new AppError("La scadenza non può precedere la data di inizio.");
  }
  const assigneeIds: string[] = [];
  for (const value of form.getAll("assignees")) {
    if (typeof value !== "string") continue;
    const id = parseUuid(value);
    if (!id) throw new AppError("Un assegnatario non è valido.");
    if (!assigneeIds.includes(id)) assigneeIds.push(id);
  }
  if (assigneeIds.length > 20) throw new AppError("Un task può avere al massimo 20 assegnatari.");
  return {
    title,
    description,
    priority: priorityRaw,
    progress: parseProgress(field(form, "progress")),
    plannedStart,
    deadline,
    status: statusRaw,
    assigneeIds,
    groupId,
  };
}

export function parseDisplayName(value: string): string | null {
  const name = cleanBounded(value, 80, "Il nome visualizzato", true);
  return name || null;
}

export function parseComment(value: string): string {
  const body = cleanBounded(value, 4000, "Il commento");
  if (!body) throw new AppError("Scrivi un commento prima di inviare.");
  return body;
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function one(sp: Record<string, string | string[] | undefined>, key: string): string {
  const value = sp[key];
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return raw.trim().slice(0, 80);
}

export function parseListQuery(sp: Record<string, string | string[] | undefined>): ListQuery {
  const statusRaw = one(sp, "status");
  const priorityRaw = one(sp, "priority");
  const sortRaw = one(sp, "sort");
  const sorts = ["updated", "deadline", "priority", "title", "created"] as const;
  const sort = (sorts as readonly string[]).includes(sortRaw) ? (sortRaw as ListQuery["sort"]) : "updated";
  return {
    q: one(sp, "q"),
    status: isStatus(statusRaw) ? statusRaw : "",
    priority: isPriority(priorityRaw) ? priorityRaw : "",
    assigneeId: parseUuid(one(sp, "assignee")) ?? "",
    sort,
  };
}

export function parseRole(value: string): RoleId {
  if (!isRole(value)) throw new AppError("Il ruolo non è valido.");
  return value;
}

export type ListQuery = {
  q: string;
  status: StatusId | "";
  priority: Priority | "";
  assigneeId: string;
  sort: "updated" | "deadline" | "priority" | "title" | "created";
};
