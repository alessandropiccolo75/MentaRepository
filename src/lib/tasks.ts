import { randomUUID } from "node:crypto";
import { asArray, asDateOnly, asInt, asIso, asObject } from "@/lib/coerce";
import type { Query } from "@/lib/db";
import { sql, withTransaction } from "@/lib/db";
import { getSettings } from "@/lib/directory";
import { AppError } from "@/lib/errors";
import { addDays, clip, formatDate, personName, todayRome } from "@/lib/format";
import { sendEmail } from "@/lib/mail";
import { STATUS_LABELS, historyText } from "@/lib/labels";
import { canComment, canCreateTask, canEditTaskFields, canTransition, canUpdateProgress } from "@/lib/permissions";
import type { Comment, HistoryEntry, NotificationItem, Priority, Stage, StatusId, TaskDetail, TaskInput, TaskSummary, Viewer } from "@/lib/types";
import { STATUSES, isPriority, isStatus } from "@/lib/types";
import { likePattern } from "@/lib/validation";
import type { ListQuery } from "@/lib/validation";

type EmailJob = { id: string; stage: Stage; to: string; subject: string; text: string };

type TaskRow = {
  id: string;
  stage: string;
  title: string;
  description?: string;
  excerpt?: string;
  author_id: string;
  author_name: string;
  status_id: string;
  priority: string;
  progress: unknown;
  planned_start: unknown;
  deadline: unknown;
  completed_at: unknown;
  closed_at: unknown;
  group_id: string;
  group_name: string;
  is_sample: boolean;
  created_at: unknown;
  updated_at: unknown;
  assignees: unknown;
};

class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function accessPredicate(alias: string, params: Params, viewer: Viewer): string {
  const role = params.add(viewer.role);
  const me = params.add(viewer.id);
  const group = params.add(viewer.groupId);
  return `(
    ${role} = 'administrator'
    or ${alias}.author_id = ${me}
    or (${role} = 'manager' and ${alias}.group_id = ${group})
    or (
      ${alias}.status_id <> 'draft'
      and exists (
        select 1 from task_assignments az
        where az.task_id = ${alias}.id and az.user_id = ${me}
      )
    )
  )`;
}

function orderBy(sort: ListQuery["sort"]): string {
  switch (sort) {
    case "deadline":
      return "t.deadline asc nulls last, t.updated_at desc";
    case "priority":
      return "case t.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.updated_at desc";
    case "title":
      return "t.title asc";
    case "created":
      return "t.created_at desc";
    default:
      return "t.updated_at desc";
  }
}

function mapAssignees(value: unknown): TaskSummary["assignees"] {
  return asArray<Record<string, unknown>>(value).flatMap((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) return [];
    const name = typeof item.name === "string" && item.name.trim() ? item.name : "Utente";
    return [{
      id,
      name,
      acceptedAt: asIso(item.acceptedAt ?? item.acceptedat),
      isSample: item.isSample === true || item.issample === true,
    }];
  });
}

function mapTask(row: TaskRow): TaskSummary {
  const status = isStatus(row.status_id) ? row.status_id : "new";
  const priority = isPriority(row.priority) ? row.priority : "normal";
  const stage: Stage = row.stage === "preview" ? "preview" : "production";
  return {
    id: String(row.id),
    stage,
    title: row.title,
    excerpt: row.excerpt ?? clip(row.description ?? "", 140),
    authorId: String(row.author_id),
    authorName: row.author_name || "Utente",
    status,
    priority,
    progress: Math.min(100, Math.max(0, asInt(row.progress))),
    plannedStart: asDateOnly(row.planned_start),
    deadline: asDateOnly(row.deadline),
    completedAt: asIso(row.completed_at),
    closedAt: asIso(row.closed_at),
    groupId: String(row.group_id),
    groupName: row.group_name,
    isSample: Boolean(row.is_sample),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date(0).toISOString(),
    assignees: mapAssignees(row.assignees),
  };
}

const TASK_FROM = `
  from tasks t
  join users author on author.id = t.author_id
  join groups g on g.id = t.group_id
  left join task_assignments a on a.task_id = t.id
  left join users assignee on assignee.id = a.user_id
`;

function taskSelect(detail: boolean): string {
  const body = detail ? "t.description" : `case when char_length(t.description) > 140 then left(t.description, 140) || '…' else t.description end as excerpt`;
  return `
    select t.id, t.stage, t.title, ${body}, t.author_id,
           coalesce(nullif(author.display_name, ''), nullif(author.identity_name, ''), author.email, 'Utente') as author_name,
           t.status_id, t.priority, t.progress, t.planned_start, t.deadline, t.completed_at, t.closed_at,
           t.group_id, g.name as group_name, t.is_sample, t.created_at, t.updated_at,
           coalesce(json_agg(json_build_object(
             'id', assignee.id,
             'name', coalesce(nullif(assignee.display_name, ''), nullif(assignee.identity_name, ''), assignee.email, 'Utente'),
             'acceptedAt', a.accepted_at,
             'isSample', assignee.is_sample
           ) order by assignee.identity_name) filter (where assignee.id is not null), '[]'::json) as assignees
    ${TASK_FROM}
  `;
}

async function queryTasks(whereSql: string, params: unknown[], orderSql: string, limit: number, detail: boolean): Promise<TaskRow[]> {
  return sql<TaskRow>(
    `${taskSelect(detail)}
     where ${whereSql}
     group by t.id, author.id, g.id
     order by ${orderSql}
     limit ${limit}`,
    params,
  );
}

function accessOf(task: TaskSummary) {
  return {
    authorId: task.authorId,
    groupId: task.groupId,
    status: task.status,
    assigneeIds: task.assignees.map((person) => person.id),
  };
}

export async function listTasks(viewer: Viewer, options: { scope: "all" | "mine"; query: ListQuery; limit?: number }): Promise<TaskSummary[]> {
  const params = new Params();
  const stage = params.add(viewer.stage);
  const where = [`t.stage = ${stage}`, accessPredicate("t", params, viewer)];
  if (options.scope === "mine") {
    const me = params.add(viewer.id);
    where.push(`exists (select 1 from task_assignments mine where mine.task_id = t.id and mine.user_id = ${me})`);
    where.push("t.status_id <> 'draft'");
  }
  if (options.query.q) {
    const pattern = params.add(likePattern(options.query.q));
    where.push(`(t.title ilike ${pattern} escape '\\' or t.description ilike ${pattern} escape '\\')`);
  }
  if (options.query.status) where.push(`t.status_id = ${params.add(options.query.status)}`);
  if (options.query.priority) where.push(`t.priority = ${params.add(options.query.priority)}`);
  if (options.query.assigneeId) {
    const assignee = params.add(options.query.assigneeId);
    where.push(`exists (select 1 from task_assignments af where af.task_id = t.id and af.user_id = ${assignee})`);
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 200);
  const rows = await queryTasks(where.join(" and "), params.values, orderBy(options.query.sort), limit, false);
  return rows.map(mapTask);
}

export async function getTask(viewer: Viewer, taskId: string): Promise<TaskDetail | null> {
  const params = new Params();
  const stage = params.add(viewer.stage);
  const id = params.add(taskId);
  const where = `t.stage = ${stage} and t.id = ${id} and ${accessPredicate("t", params, viewer)}`;
  const rows = await queryTasks(where, params.values, "t.updated_at desc", 1, true);
  const row = rows[0];
  if (!row) return null;
  const summary = mapTask(row);
  return { ...summary, description: row.description ?? "" };
}

export async function listComments(viewer: Viewer, taskId: string): Promise<Comment[]> {
  const rows = await sql<{ id: string; body: string; created_at: unknown; author_id: string; author_name: string; is_sample: boolean }>(
    `select c.id, c.body, c.created_at, c.author_id, u.is_sample,
            coalesce(nullif(u.display_name, ''), nullif(u.identity_name, ''), u.email, 'Utente') as author_name
     from comments c
     join users u on u.id = c.author_id
     where c.task_id = $1 and c.stage = $2
     order by c.created_at asc
     limit 200`,
    [taskId, viewer.stage],
  );
  return rows.map((row) => ({
    id: String(row.id),
    body: row.body,
    createdAt: asIso(row.created_at) ?? "",
    authorId: String(row.author_id),
    authorName: row.author_name,
    isSample: Boolean(row.is_sample),
  }));
}

export async function listHistory(viewer: Viewer, taskId: string): Promise<HistoryEntry[]> {
  const rows = await sql<{ id: string; action: string; detail: unknown; created_at: unknown; actor_name: string | null }>(
    `select h.id, h.action, h.detail, h.created_at,
            coalesce(nullif(u.display_name, ''), nullif(u.identity_name, ''), u.email, 'Sistema') as actor_name
     from task_history h
     left join users u on u.id = h.actor_id
     where h.task_id = $1 and h.stage = $2
     order by h.created_at desc
     limit 100`,
    [taskId, viewer.stage],
  );
  return rows.map((row) => ({
    id: String(row.id),
    action: row.action,
    detail: asObject(row.detail),
    createdAt: asIso(row.created_at) ?? "",
    actorName: row.actor_name || "Sistema",
  }));
}

async function assertCapacity(q: Query, stage: Stage): Promise<void> {
  const rows = await q<{ n: unknown }>("select count(*) as n from tasks where stage = $1", [stage]);
  if (asInt(rows[0]?.n) >= 5000) throw new AppError("È stato raggiunto il limite di task.");
}

async function resolveGroup(q: Query, viewer: Viewer, requested: string): Promise<string> {
  if (viewer.role !== "administrator") return viewer.groupId;
  const rows = await q<{ id: string }>("select id from groups where id = $1 and stage = $2", [requested, viewer.stage]);
  if (!rows[0]) throw new AppError("Gruppo non valido.");
  return String(rows[0].id);
}

type Person = { id: string; name: string; email: string; isSample: boolean; disabled: boolean; groupId: string };

async function loadPeople(q: Query, stage: Stage, ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const params = new Params();
  const stageRef = params.add(stage);
  const placeholders = ids.map((id) => params.add(id)).join(", ");
  const rows = await q<{ id: string; display_name: string | null; identity_name: string; email: string; is_sample: boolean; disabled: boolean; group_id: string }>(
    `select id, display_name, identity_name, email, is_sample, disabled, group_id
     from users
     where stage = ${stageRef} and id in (${placeholders})`,
    params.values,
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: personName(row.display_name, row.identity_name, row.email),
    email: row.email ?? "",
    isSample: Boolean(row.is_sample),
    disabled: Boolean(row.disabled),
    groupId: String(row.group_id),
  }));
}

function normalizeStatus(status: StatusId, assigneeCount: number): StatusId {
  if (status === "new" && assigneeCount > 0) return "assigned";
  if (status === "assigned" && assigneeCount === 0) return "new";
  return status;
}

async function addHistory(q: Query, viewer: Viewer, taskId: string, action: string, detail: Record<string, unknown>): Promise<void> {
  await q(
    `insert into task_history (stage, task_id, actor_id, action, detail)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [viewer.stage, taskId, viewer.id, action, JSON.stringify(detail)],
  );
}

async function notify(
  q: Query,
  jobs: EmailJob[],
  input: {
    stage: Stage;
    userId: string;
    email: string;
    isSample: boolean;
    taskId: string | null;
    kind: string;
    title: string;
    body: string;
    dedupeKey: string;
    deliver: boolean;
  },
): Promise<void> {
  const rows = await q<{ id: string }>(
    `insert into notifications (stage, user_id, task_id, kind, title, body, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (stage, dedupe_key) do nothing
     returning id`,
    [input.stage, input.userId, input.taskId, input.kind, clip(input.title, 180), clip(input.body, 600), input.dedupeKey],
  );
  if (!rows[0] || !input.deliver || input.isSample) return;
  const queued = await q<{ id: string }>(
    `insert into email_messages (stage, notification_id, to_address, subject, body, status)
     values ($1, $2, $3, $4, $5, 'queued')
     returning id`,
    [input.stage, rows[0].id, input.email.slice(0, 200), clip(input.title, 180), clip(input.body, 4000)],
  );
  if (queued[0]) {
    jobs.push({
      id: String(queued[0].id),
      stage: input.stage,
      to: input.email,
      subject: clip(input.title, 180),
      text: `${input.body}\n\nApri Assegna per il dettaglio. Messaggio generato automaticamente.`,
    });
  }
}

export async function flushEmails(jobs: EmailJob[]): Promise<void> {
  for (const job of jobs) {
    let status: "sent" | "skipped" | "failed" = "failed";
    let error = "Invio non riuscito";
    try {
      const result = await sendEmail({ to: job.to, subject: job.subject, text: job.text });
      status = result.status;
      error = result.error ?? "";
    } catch {
      status = "failed";
      error = "Invio non riuscito";
    }
    try {
      await sql(
        `update email_messages
         set status = $1, error = nullif($2, ''), sent_at = case when $1 = 'sent' then now() else null end
         where id = $3 and stage = $4`,
        [status, error, job.id, job.stage],
      );
    } catch {
      console.error("assegna:email-status");
    }
  }
}

export async function createTask(viewer: Viewer, input: TaskInput): Promise<string> {
  if (!canCreateTask(viewer.role)) throw new AppError("Non puoi creare task.", 403);
  const jobs: EmailJob[] = [];
  const id = await withTransaction(async (q) => {
    await assertCapacity(q, viewer.stage);
    const groupId = await resolveGroup(q, viewer, input.groupId);
    const people = await loadPeople(q, viewer.stage, input.assigneeIds);
    if (people.length !== input.assigneeIds.length) throw new AppError("Un assegnatario non è valido.");
    for (const person of people) {
      if (person.disabled) throw new AppError("Non puoi assegnare un utente disabilitato.");
      if (viewer.role === "manager" && person.groupId !== viewer.groupId) {
        throw new AppError("Puoi assegnare solo persone del tuo gruppo.");
      }
    }
    const status = normalizeStatus(input.status, people.length);
    const progress = status === "completed" || status === "closed" ? 100 : input.progress;
    const rows = await q<{ id: string }>(
      `insert into tasks (
         stage, title, description, author_id, status_id, priority, progress, planned_start, deadline,
         completed_at, closed_at, group_id
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         case when $5 in ('completed', 'closed') then now() else null end,
         case when $5 in ('closed', 'cancelled') then now() else null end,
         $10
       ) returning id`,
      [viewer.stage, input.title, input.description, viewer.id, status, input.priority, progress, input.plannedStart, input.deadline, groupId],
    );
    const taskId = String(rows[0]?.id);
    for (const person of people) {
      const acceptedNow = ["accepted", "wip", "blocked", "completed", "closed"].includes(status) && person.id === viewer.id;
      await q(
        `insert into task_assignments (stage, task_id, user_id, assigned_by, accepted_at)
         values ($1, $2, $3, $4, case when $5::boolean then now() else null end)`,
        [viewer.stage, taskId, person.id, viewer.id, acceptedNow],
      );
    }
    await addHistory(q, viewer, taskId, "created", {});
    if (status !== "draft") {
      for (const person of people) {
        if (person.id === viewer.id) continue;
        await notify(q, jobs, {
          stage: viewer.stage,
          userId: person.id,
          email: person.email,
          isSample: person.isSample,
          taskId,
          kind: "assigned",
          title: `Nuovo task assegnato: ${input.title}`,
          body: `${viewer.name} ti ha assegnato «${input.title}».`,
          dedupeKey: `event:${randomUUID()}`,
          deliver: true,
        });
      }
    }
    return taskId;
  });
  await flushEmails(jobs);
  return id;
}

export async function updateTask(viewer: Viewer, taskId: string, input: TaskInput): Promise<void> {
  const current = await getTask(viewer, taskId);
  if (!current) throw new AppError("Task non trovato.", 404);
  if (!canEditTaskFields(viewer, accessOf(current))) throw new AppError("Non puoi modificare questo task.", 403);
  const jobs: EmailJob[] = [];
  await withTransaction(async (q) => {
    const groupId = await resolveGroup(q, viewer, input.groupId);
    const previousIds = new Set(current.assignees.map((person) => person.id));
    const people = await loadPeople(q, viewer.stage, input.assigneeIds);
    if (people.length !== input.assigneeIds.length) throw new AppError("Un assegnatario non è valido.");
    for (const person of people) {
      if (person.disabled && !previousIds.has(person.id)) throw new AppError("Non puoi assegnare un utente disabilitato.");
      if (viewer.role === "manager" && person.groupId !== viewer.groupId && !previousIds.has(person.id)) {
        throw new AppError("Puoi assegnare solo persone del tuo gruppo.");
      }
    }
    let status = normalizeStatus(input.status, people.length);
    if (!canTransition(viewer, accessOf(current), status) && status !== current.status) {
      throw new AppError("Questo passaggio di stato non è consentito.", 403);
    }
    const progress = status === "completed" || status === "closed" ? 100 : input.progress;
    const updated = await q(
      `update tasks set
         title = $1,
         description = $2,
         status_id = $3,
         priority = $4,
         progress = $5,
         planned_start = $6,
         deadline = $7,
         group_id = $8,
         completed_at = case
           when $3 in ('completed', 'closed') then coalesce(completed_at, now())
           when $3 = 'cancelled' then completed_at
           else null
         end,
         closed_at = case
           when $3 in ('closed', 'cancelled') then coalesce(closed_at, now())
           else null
         end,
         updated_at = now()
       where id = $9 and stage = $10
       returning id`,
      [input.title, input.description, status, input.priority, progress, input.plannedStart, input.deadline, groupId, taskId, viewer.stage],
    );
    if (!updated.length) throw new AppError("Task non trovato.", 404);

    const nextIds = new Set(people.map((person) => person.id));
    for (const person of current.assignees) {
      if (!nextIds.has(person.id)) {
        await q("delete from task_assignments where task_id = $1 and user_id = $2 and stage = $3", [taskId, person.id, viewer.stage]);
        await addHistory(q, viewer, taskId, "unassigned", { name: person.name });
      }
    }
    const added: Person[] = [];
    for (const person of people) {
      if (previousIds.has(person.id)) continue;
      await q(
        "insert into task_assignments (stage, task_id, user_id, assigned_by) values ($1, $2, $3, $4)",
        [viewer.stage, taskId, person.id, viewer.id],
      );
      await addHistory(q, viewer, taskId, "assigned", { name: person.name });
      added.push(person);
    }
    if ((status === "accepted" || status === "wip" || status === "blocked" || status === "completed" || status === "closed") && nextIds.has(viewer.id)) {
      await q(
        "update task_assignments set accepted_at = coalesce(accepted_at, now()) where task_id = $1 and user_id = $2 and stage = $3",
        [taskId, viewer.id, viewer.stage],
      );
    }

    const fieldChanges = changedFields(current, input, groupId);
    if (fieldChanges.length) await addHistory(q, viewer, taskId, "updated", { fields: fieldChanges });
    if (current.progress !== progress && !fieldChanges.includes("avanzamento")) {
      await addHistory(q, viewer, taskId, "progress", { progress });
    }
    if (current.status !== status) await addHistory(q, viewer, taskId, "status_changed", { from: current.status, to: status });

    if (status === "draft") return;
    const leavingDraft = current.status === "draft";
    for (const person of added) {
      if (person.id === viewer.id) continue;
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: person.id,
        email: person.email,
        isSample: person.isSample,
        taskId,
        kind: "assigned",
        title: `Nuovo task assegnato: ${input.title}`,
        body: `${viewer.name} ti ha assegnato «${input.title}».`,
        dedupeKey: `event:${randomUUID()}`,
        deliver: !current.isSample,
      });
    }
    const recipients = await recipientPeople(q, viewer, taskId, current.authorId, new Set(added.map((person) => person.id)));
    const kind = status === "completed" || status === "closed" ? "completed" : current.status !== status ? "status_changed" : "updated";
    if (current.status === status && fieldChanges.length === 0) return;
    for (const person of recipients) {
      if (!leavingDraft && current.status === status && fieldChanges.length === 0) continue;
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: person.id,
        email: person.email,
        isSample: person.isSample,
        taskId,
        kind,
        title: noticeTitle(kind, input.title),
        body: noticeBody(kind, viewer.name, input.title, current.status, status, fieldChanges),
        dedupeKey: `event:${randomUUID()}`,
        deliver: !current.isSample,
      });
    }
  });
  await flushEmails(jobs);
}

function changedFields(current: TaskDetail, input: TaskInput, groupId: string): string[] {
  const fields: string[] = [];
  if (current.title !== input.title) fields.push("titolo");
  if (current.description !== input.description) fields.push("descrizione");
  if (current.priority !== input.priority) fields.push("priorità");
  if (current.plannedStart !== input.plannedStart) fields.push("data di inizio");
  if (current.deadline !== input.deadline) fields.push("scadenza");
  if (current.groupId !== groupId) fields.push("gruppo");
  return fields;
}

function noticeTitle(kind: string, title: string): string {
  if (kind === "completed") return `Task completato: ${title}`;
  if (kind === "accepted") return `Task preso in carico: ${title}`;
  if (kind === "status_changed") return `Stato aggiornato: ${title}`;
  if (kind === "assigned") return `Nuovo task assegnato: ${title}`;
  return `Task modificato: ${title}`;
}

function noticeBody(kind: string, actor: string, title: string, from: StatusId, to: StatusId, fields: string[]): string {
  if (kind === "completed") return `${actor} ha completato «${title}».`;
  if (kind === "accepted") return `${actor} ha preso in carico «${title}».`;
  if (kind === "status_changed") {
    const extra = fields.length ? ` Ha anche modificato: ${fields.join(", ")}.` : "";
    return `${actor} ha portato «${title}» da ${STATUS_LABELS[from]} a ${STATUS_LABELS[to]}.${extra}`;
  }
  const extra = fields.length ? ` Campi: ${fields.join(", ")}.` : "";
  return `${actor} ha modificato «${title}».${extra}`;
}

async function recipientPeople(q: Query, viewer: Viewer, taskId: string, authorId: string, skip: Set<string>): Promise<Person[]> {
  const rows = await q<{ user_id: string }>("select user_id from task_assignments where task_id = $1 and stage = $2", [taskId, viewer.stage]);
  const ids = new Set(rows.map((row) => String(row.user_id)));
  ids.add(authorId);
  ids.delete(viewer.id);
  for (const id of skip) ids.delete(id);
  const people = await loadPeople(q, viewer.stage, [...ids]);
  return people.filter((person) => !person.disabled);
}

export async function setStatus(viewer: Viewer, taskId: string, status: StatusId): Promise<void> {
  const current = await getTask(viewer, taskId);
  if (!current) throw new AppError("Task non trovato.", 404);
  if (!canTransition(viewer, accessOf(current), status)) throw new AppError("Questo passaggio di stato non è consentito.", 403);
  const jobs: EmailJob[] = [];
  await withTransaction(async (q) => {
    const progress = status === "completed" || status === "closed" ? 100 : current.progress;
    const updated = await q(
      `update tasks set
         status_id = $1,
         progress = $2,
         completed_at = case
           when $1 in ('completed', 'closed') then coalesce(completed_at, now())
           when $1 = 'cancelled' then completed_at
           else null
         end,
         closed_at = case when $1 in ('closed', 'cancelled') then coalesce(closed_at, now()) else null end,
         updated_at = now()
       where id = $3 and stage = $4
       returning id`,
      [status, progress, taskId, viewer.stage],
    );
    if (!updated.length) throw new AppError("Task non trovato.", 404);
    if (["accepted", "wip", "blocked", "completed", "closed"].includes(status)) {
      await q(
        "update task_assignments set accepted_at = coalesce(accepted_at, now()) where task_id = $1 and user_id = $2 and stage = $3",
        [taskId, viewer.id, viewer.stage],
      );
    }
    await addHistory(q, viewer, taskId, status === "accepted" ? "accepted" : "status_changed", { from: current.status, to: status });
    if (status === "draft") return;
    const kind = status === "accepted" ? "accepted" : status === "completed" || status === "closed" ? "completed" : "status_changed";
    const recipients = await recipientPeople(q, viewer, taskId, current.authorId, new Set());
    for (const person of recipients) {
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: person.id,
        email: person.email,
        isSample: person.isSample,
        taskId,
        kind,
        title: noticeTitle(kind, current.title),
        body: noticeBody(kind, viewer.name, current.title, current.status, status, []),
        dedupeKey: `event:${randomUUID()}`,
        deliver: !current.isSample,
      });
    }
  });
  await flushEmails(jobs);
}

export async function acceptTask(viewer: Viewer, taskId: string): Promise<void> {
  const current = await getTask(viewer, taskId);
  if (!current) throw new AppError("Task non trovato.", 404);
  if (!current.assignees.some((person) => person.id === viewer.id)) {
    throw new AppError("Puoi prendere in carico solo un task assegnato a te.", 403);
  }
  if (current.status === "draft" || current.status === "cancelled" || current.status === "closed") {
    throw new AppError("Questo task non può essere preso in carico.", 403);
  }
  const mine = current.assignees.find((person) => person.id === viewer.id);
  if (mine?.acceptedAt && current.status !== "assigned" && current.status !== "new") return;
  if (current.status === "assigned" || current.status === "new") {
    await setStatus(viewer, taskId, "accepted");
    return;
  }
  const jobs: EmailJob[] = [];
  await withTransaction(async (q) => {
    const stamped = await q<{ accepted_at: unknown }>(
      `update task_assignments
       set accepted_at = coalesce(accepted_at, now())
       where task_id = $1 and user_id = $2 and stage = $3 and accepted_at is null
       returning accepted_at`,
      [taskId, viewer.id, viewer.stage],
    );
    if (!stamped.length) return;
    await addHistory(q, viewer, taskId, "accepted", {});
    const recipients = await recipientPeople(q, viewer, taskId, current.authorId, new Set());
    for (const person of recipients) {
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: person.id,
        email: person.email,
        isSample: person.isSample,
        taskId,
        kind: "accepted",
        title: `Task preso in carico: ${current.title}`,
        body: `${viewer.name} ha preso in carico «${current.title}».`,
        dedupeKey: `event:${randomUUID()}`,
        deliver: !current.isSample,
      });
    }
  });
  await flushEmails(jobs);
}

export async function setProgress(viewer: Viewer, taskId: string, progress: number): Promise<void> {
  const current = await getTask(viewer, taskId);
  if (!current) throw new AppError("Task non trovato.", 404);
  if (!canUpdateProgress(viewer, accessOf(current))) throw new AppError("Non puoi aggiornare l'avanzamento.", 403);
  if (current.progress === progress) return;
  await withTransaction(async (q) => {
    await q("update tasks set progress = $1, updated_at = now() where id = $2 and stage = $3", [progress, taskId, viewer.stage]);
    await addHistory(q, viewer, taskId, "progress", { progress });
  });
}

export async function addComment(viewer: Viewer, taskId: string, body: string): Promise<void> {
  const current = await getTask(viewer, taskId);
  if (!current) throw new AppError("Task non trovato.", 404);
  if (!canComment(viewer, accessOf(current))) throw new AppError("Non puoi commentare questo task.", 403);
  const jobs: EmailJob[] = [];
  await withTransaction(async (q) => {
    const count = await q<{ n: unknown }>("select count(*) as n from comments where task_id = $1", [taskId]);
    if (asInt(count[0]?.n) >= 1000) throw new AppError("Questo task ha raggiunto il limite di commenti.");
    await q(
      "insert into comments (stage, task_id, author_id, body) values ($1, $2, $3, $4)",
      [viewer.stage, taskId, viewer.id, body],
    );
    await q("update tasks set updated_at = now() where id = $1 and stage = $2", [taskId, viewer.stage]);
    await addHistory(q, viewer, taskId, "commented", {});
    if (current.status === "draft") return;
    const recipients = await recipientPeople(q, viewer, taskId, current.authorId, new Set());
    const snippet = clip(body, 140);
    for (const person of recipients) {
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: person.id,
        email: person.email,
        isSample: person.isSample,
        taskId,
        kind: "comment",
        title: `Nuovo commento: ${current.title}`,
        body: `${viewer.name}: ${snippet}`,
        dedupeKey: `event:${randomUUID()}`,
        deliver: !current.isSample,
      });
    }
  });
  await flushEmails(jobs);
}

export async function dashboard(viewer: Viewer) {
  const settings = await getSettings(viewer.stage);
  const params = new Params();
  const todayValue = todayRome();
  const today = params.add(todayValue);
  const soon = params.add(addDays(todayValue, settings.dueSoonDays));
  const stage = params.add(viewer.stage);
  const access = accessPredicate("t", params, viewer);
  const where = `t.stage = ${stage} and ${access}`;
  const counts = await sql<{
    open_count: unknown;
    completed_count: unknown;
    wip_count: unknown;
    overdue_count: unknown;
    due_soon_count: unknown;
  }>(
    `select
       count(*) filter (where t.status_id not in ('draft', 'completed', 'closed', 'cancelled')) as open_count,
       count(*) filter (where t.status_id = 'completed') as completed_count,
       count(*) filter (where t.status_id = 'wip') as wip_count,
       count(*) filter (where t.deadline is not null and t.deadline < ${today}::date and t.status_id not in ('draft', 'completed', 'closed', 'cancelled')) as overdue_count,
       count(*) filter (where t.deadline is not null and t.deadline >= ${today}::date and t.deadline <= ${soon}::date and t.status_id not in ('draft', 'completed', 'closed', 'cancelled')) as due_soon_count
     from tasks t
     where ${where}`,
    params.values,
  );
  const statusScope = new Params();
  const statusStage = statusScope.add(viewer.stage);
  const statusAccess = accessPredicate("t", statusScope, viewer);
  const byStatusRows = await sql<{ status_id: string; n: unknown }>(
    `select t.status_id, count(*) as n from tasks t where t.stage = ${statusStage} and ${statusAccess} group by t.status_id`,
    statusScope.values,
  );
  const priorityScope = new Params();
  const priorityStage = priorityScope.add(viewer.stage);
  const priorityAccess = accessPredicate("t", priorityScope, viewer);
  const byPriorityRows = await sql<{ priority: string; n: unknown }>(
    `select t.priority, count(*) as n from tasks t where t.stage = ${priorityStage} and ${priorityAccess} group by t.priority`,
    priorityScope.values,
  );
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<StatusId, number>;
  for (const row of byStatusRows) if (isStatus(row.status_id)) statusCounts[row.status_id] = asInt(row.n);
  const priorityCounts: Record<Priority, number> = { low: 0, normal: 0, high: 0, critical: 0 };
  for (const row of byPriorityRows) if (isPriority(row.priority)) priorityCounts[row.priority] = asInt(row.n);
  const recent = await listTasks(viewer, { scope: "all", query: { q: "", status: "", priority: "", assigneeId: "", sort: "updated" }, limit: 6 });
  const activity = await listActivity(viewer, 8);
  const row = counts[0];
  return {
    open: asInt(row?.open_count),
    completed: asInt(row?.completed_count),
    wip: asInt(row?.wip_count),
    overdue: asInt(row?.overdue_count),
    dueSoon: asInt(row?.due_soon_count),
    statusCounts,
    priorityCounts,
    recent,
    activity,
    dueSoonDays: settings.dueSoonDays,
  };
}

export async function listActivity(viewer: Viewer, limit: number): Promise<{ id: string; taskId: string; title: string; text: string; actorName: string; createdAt: string }[]> {
  const params = new Params();
  const stage = params.add(viewer.stage);
  const access = accessPredicate("t", params, viewer);
  const rows = await sql<{ id: string; task_id: string; title: string; action: string; detail: unknown; created_at: unknown; actor_name: string | null }>(
    `select h.id, h.task_id, t.title, h.action, h.detail, h.created_at,
            coalesce(nullif(u.display_name, ''), nullif(u.identity_name, ''), u.email, 'Sistema') as actor_name
     from task_history h
     join tasks t on t.id = h.task_id
     left join users u on u.id = h.actor_id
     where t.stage = ${stage} and h.stage = ${stage} and ${access}
     order by h.created_at desc
     limit ${Math.min(limit, 30)}`,
    params.values,
  );
  return rows.map((row) => ({
    id: String(row.id),
    taskId: String(row.task_id),
    title: row.title,
    text: historyText(row.action, asObject(row.detail)),
    actorName: row.actor_name || "Sistema",
    createdAt: asIso(row.created_at) ?? "",
  }));
}

export async function listPending(viewer: Viewer): Promise<TaskSummary[]> {
  const params = new Params();
  const stage = params.add(viewer.stage);
  const me = params.add(viewer.id);
  const where = `t.stage = ${stage} and t.status_id in ('new', 'assigned') and exists (
    select 1 from task_assignments p where p.task_id = t.id and p.user_id = ${me} and p.accepted_at is null
  )`;
  const rows = await queryTasks(where, params.values, "t.updated_at desc", 20, false);
  return rows.map(mapTask);
}

export async function listNotifications(viewer: Viewer): Promise<NotificationItem[]> {
  const rows = await sql<{ id: string; kind: string; title: string; body: string; task_id: string | null; read_at: unknown; created_at: unknown }>(
    `select id, kind, title, body, task_id, read_at, created_at
     from notifications
     where stage = $1 and user_id = $2
     order by created_at desc
     limit 100`,
    [viewer.stage, viewer.id],
  );
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    taskId: row.task_id ? String(row.task_id) : null,
    readAt: asIso(row.read_at),
    createdAt: asIso(row.created_at) ?? "",
  }));
}

export async function unreadCount(viewer: Viewer): Promise<number> {
  const rows = await sql<{ n: unknown }>(
    "select count(*) as n from notifications where stage = $1 and user_id = $2 and read_at is null",
    [viewer.stage, viewer.id],
  );
  return asInt(rows[0]?.n);
}

export async function markRead(viewer: Viewer, notificationId: string): Promise<void> {
  await sql(
    "update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 and stage = $3",
    [notificationId, viewer.id, viewer.stage],
  );
}

export async function markAllRead(viewer: Viewer): Promise<void> {
  await sql(
    "update notifications set read_at = now() where user_id = $1 and stage = $2 and read_at is null",
    [viewer.id, viewer.stage],
  );
}

export async function syncDeadlines(viewer: Viewer): Promise<void> {
  const settings = await getSettings(viewer.stage);
  const today = todayRome();
  const soon = addDays(today, settings.dueSoonDays);
  const rows = await sql<{ id: string; title: string; deadline: unknown; is_sample: boolean }>(
    `select t.id, t.title, t.deadline, t.is_sample
     from tasks t
     join task_assignments a on a.task_id = t.id and a.user_id = $2
     where t.stage = $1
       and t.deadline is not null
       and t.deadline <= $3::date
       and t.status_id not in ('draft', 'completed', 'closed', 'cancelled')`,
    [viewer.stage, viewer.id, soon],
  );
  const jobs: EmailJob[] = [];
  await withTransaction(async (q) => {
    for (const row of rows) {
      const deadline = asDateOnly(row.deadline);
      if (!deadline) continue;
      const overdue = deadline < today;
      await notify(q, jobs, {
        stage: viewer.stage,
        userId: viewer.id,
        email: viewer.email,
        isSample: viewer.isSample,
        taskId: String(row.id),
        kind: overdue ? "overdue" : "due_soon",
        title: overdue ? `Task scaduto: ${row.title}` : `Task in scadenza: ${row.title}`,
        body: overdue
          ? `La scadenza del ${formatDate(deadline)} è passata.`
          : `La scadenza è il ${formatDate(deadline)}.`,
        dedupeKey: `${overdue ? "overdue" : "due_soon"}:${row.id}:${viewer.id}:${deadline}`,
        deliver: !row.is_sample,
      });
    }
  });
  await flushEmails(jobs);
}
