import { randomUUID } from "node:crypto";
import { asInt, asIso } from "@/lib/coerce";
import type { Query } from "@/lib/db";
import { sql, withTransaction } from "@/lib/db";
import { AppError, rethrowDb } from "@/lib/errors";
import { addDays, personName, todayRome } from "@/lib/format";
import { canConfigure, canManageUsers } from "@/lib/permissions";
import type { Group, Member, RoleId, Settings, Stage, StatusId, Viewer } from "@/lib/types";
import { isRole } from "@/lib/types";
import { cleanBounded, slugify } from "@/lib/validation";

type UserRow = {
  id: string;
  stage: string;
  email: string;
  identity_name: string;
  display_name: string | null;
  role_id: string;
  group_id: string;
  group_name: string;
  disabled: boolean;
  is_sample: boolean;
};

function mapViewer(row: UserRow): Viewer {
  const role = isRole(row.role_id) ? row.role_id : "user";
  const stage: Stage = row.stage === "preview" ? "preview" : "production";
  return {
    id: String(row.id),
    stage,
    email: row.email ?? "",
    identityName: row.identity_name ?? "",
    displayName: row.display_name,
    name: personName(row.display_name, row.identity_name ?? "", row.email ?? ""),
    role,
    groupId: String(row.group_id),
    groupName: row.group_name,
    disabled: Boolean(row.disabled),
    isSample: Boolean(row.is_sample),
  };
}

const USER_SELECT = `
  select u.id, u.stage, u.email, u.identity_name, u.display_name, u.role_id, u.group_id,
         g.name as group_name, u.disabled, u.is_sample
  from users u
  join groups g on g.id = u.group_id
`;

async function ensureGroup(q: Query, stage: Stage, slug: string, name: string): Promise<string> {
  const rows = await q<{ id: string }>(
    `insert into groups (stage, slug, name)
     values ($1, $2, $3)
     on conflict (stage, slug) do update set slug = excluded.slug
     returning id`,
    [stage, slug, name],
  );
  return String(rows[0]?.id);
}

export async function upsertViewer(input: { stage: Stage; sub: string; email: string; name: string }): Promise<Viewer> {
  if (!input.sub || input.sub.length > 200) throw new AppError("Identità non valida.", 401);
  const email = input.email.trim().slice(0, 200);
  const name = input.name.trim().slice(0, 120);
  return withTransaction(async (q) => {
    await q("select pg_advisory_xact_lock(hashtext($1)::bigint)", [`assegna-bootstrap:${input.stage}`]);
    const groupId = await ensureGroup(q, input.stage, "generale", "Generale");
    const rows = await q<UserRow>(
      `insert into users (stage, identity_sub, email, identity_name, role_id, group_id, last_seen_at)
       values (
         $1, $2, $3, $4,
         case
           when exists (
             select 1 from users
             where stage = $1 and role_id = 'administrator' and is_sample = false
           ) then 'user'
           else 'administrator'
         end,
         $5,
         now()
       )
       on conflict (stage, identity_sub) do update set
         email = case when excluded.email <> '' then excluded.email else users.email end,
         identity_name = case when excluded.identity_name <> '' then excluded.identity_name else users.identity_name end,
         last_seen_at = now(),
         updated_at = now()
       returning id`,
      [input.stage, input.sub, email, name, groupId],
    );
    const loaded = await q<UserRow>(`${USER_SELECT} where u.id = $1 and u.stage = $2`, [rows[0]?.id, input.stage]);
    if (!loaded[0]) throw new AppError("Profilo non disponibile.", 500);
    return mapViewer(loaded[0]);
  });
}

export async function getSettings(stage: Stage): Promise<Settings> {
  const rows = await sql<{ key: string; value: string }>("select key, value from app_settings where stage = $1", [stage]);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const days = Number(map.get("due_soon_days") ?? "3");
  return {
    orgName: (map.get("org_name") || "Assegna").slice(0, 80),
    dueSoonDays: Number.isInteger(days) && days >= 1 && days <= 30 ? days : 3,
  };
}

export async function saveSettings(actor: Viewer, input: { orgName: string; dueSoonDays: number }): Promise<void> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può modificare la configurazione.", 403);
  const orgName = cleanBounded(input.orgName, 80, "Il nome dell'organizzazione", true);
  if (orgName.length < 2) throw new AppError("Il nome dell'organizzazione è troppo corto.");
  if (!Number.isInteger(input.dueSoonDays) || input.dueSoonDays < 1 || input.dueSoonDays > 30) {
    throw new AppError("I giorni di preavviso devono essere tra 1 e 30.");
  }
  await withTransaction(async (q) => {
    for (const [key, value] of [
      ["org_name", orgName],
      ["due_soon_days", String(input.dueSoonDays)],
    ] as const) {
      await q(
        `insert into app_settings (stage, key, value)
         values ($1, $2, $3)
         on conflict (stage, key) do update set value = excluded.value, updated_at = now()`,
        [actor.stage, key, value],
      );
    }
  });
}

export async function listRoles(): Promise<{ id: RoleId; label: string; description: string }[]> {
  const rows = await sql<{ id: string; label: string; description: string }>(
    "select id, label, description from roles order by sort_order",
  );
  return rows.flatMap((row) => (isRole(row.id) ? [{ id: row.id, label: row.label, description: row.description }] : []));
}

export async function listGroups(actor: Viewer): Promise<Group[]> {
  const rows = await sql<{ id: string; slug: string; name: string; user_count: unknown; task_count: unknown }>(
    `select g.id, g.slug, g.name,
            (select count(*) from users u where u.group_id = g.id) as user_count,
            (select count(*) from tasks t where t.group_id = g.id) as task_count
     from groups g
     where g.stage = $1
     order by g.name`,
    [actor.stage],
  );
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    userCount: asInt(row.user_count),
    taskCount: asInt(row.task_count),
  }));
}

export async function createGroup(actor: Viewer, name: string): Promise<void> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può creare gruppi.", 403);
  const label = cleanBounded(name, 60, "Il nome del gruppo", true);
  if (label.length < 2) throw new AppError("Il nome del gruppo è troppo corto.");
  const slug = slugify(label);
  if (slug.length < 2) throw new AppError("Il nome del gruppo non contiene caratteri utilizzabili.");
  try {
    await sql("insert into groups (stage, slug, name) values ($1, $2, $3)", [actor.stage, slug, label]);
  } catch (error) {
    rethrowDb(error);
  }
}

export async function renameGroup(actor: Viewer, groupId: string, name: string): Promise<void> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può rinominare i gruppi.", 403);
  const label = cleanBounded(name, 60, "Il nome del gruppo", true);
  if (label.length < 2) throw new AppError("Il nome del gruppo è troppo corto.");
  const rows = await sql("update groups set name = $1 where id = $2 and stage = $3 returning id", [label, groupId, actor.stage]);
  if (!rows.length) throw new AppError("Gruppo non trovato.", 404);
}

export async function deleteGroup(actor: Viewer, groupId: string): Promise<void> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può eliminare i gruppi.", 403);
  if (groupId === actor.groupId) throw new AppError("Non puoi eliminare il gruppo a cui appartieni.");
  const counts = await sql<{ users: unknown; tasks: unknown }>(
    `select
       (select count(*) from users where group_id = $1) as users,
       (select count(*) from tasks where group_id = $1) as tasks`,
    [groupId],
  );
  if (asInt(counts[0]?.users) > 0 || asInt(counts[0]?.tasks) > 0) {
    throw new AppError("Il gruppo contiene ancora utenti o task.");
  }
  const rows = await sql("delete from groups where id = $1 and stage = $2 returning id", [groupId, actor.stage]);
  if (!rows.length) throw new AppError("Gruppo non trovato.", 404);
}

export async function listMembers(actor: Viewer, query = ""): Promise<Member[]> {
  if (!canManageUsers(actor.role)) throw new AppError("Solo un amministratore può vedere l'elenco utenti.", 403);
  const rows = await sql<UserRow & { last_seen_at: unknown; created_at: unknown }>(
    `select u.id, u.stage, u.email, u.identity_name, u.display_name, u.role_id, u.group_id,
            g.name as group_name, u.disabled, u.is_sample, u.last_seen_at, u.created_at
     from users u
     join groups g on g.id = u.group_id
     where u.stage = $1
       and (
         $2 = ''
         or u.identity_name ilike $3 escape '\\'
         or coalesce(u.display_name, '') ilike $3 escape '\\'
         or u.email ilike $3 escape '\\'
       )
     order by u.is_sample, u.identity_name
     limit 200`,
    [actor.stage, query, query ? `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : "%"],
  );
  return rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    name: personName(row.display_name, row.identity_name, row.email),
    role: isRole(row.role_id) ? row.role_id : "user",
    groupId: String(row.group_id),
    groupName: row.group_name,
    disabled: Boolean(row.disabled),
    isSample: Boolean(row.is_sample),
    lastSeenAt: asIso(row.last_seen_at),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function listAssignable(actor: Viewer): Promise<{ id: string; name: string; isSample: boolean; groupName: string }[]> {
  if (actor.role === "user") return [];
  const rows = await sql<{ id: string; display_name: string | null; identity_name: string; email: string; is_sample: boolean; group_name: string; group_id: string }>(
    `select u.id, u.display_name, u.identity_name, u.email, u.is_sample, u.group_id, g.name as group_name
     from users u
     join groups g on g.id = u.group_id
     where u.stage = $1 and u.disabled = false
     order by g.name, u.identity_name
     limit 500`,
    [actor.stage],
  );
  return rows
    .filter((row) => actor.role === "administrator" || String(row.group_id) === actor.groupId)
    .map((row) => ({
      id: String(row.id),
      name: personName(row.display_name, row.identity_name, row.email),
      isSample: Boolean(row.is_sample),
      groupName: row.group_name,
    }));
}

export async function updateProfile(actor: Viewer, displayName: string | null): Promise<void> {
  await sql("update users set display_name = $1, updated_at = now() where id = $2 and stage = $3", [
    displayName,
    actor.id,
    actor.stage,
  ]);
}

export async function updateMember(
  actor: Viewer,
  input: { userId: string; role: RoleId; groupId: string; disabled: boolean },
): Promise<void> {
  if (!canManageUsers(actor.role)) throw new AppError("Solo un amministratore può modificare gli utenti.", 403);
  await withTransaction(async (q) => {
    const targetRows = await q<UserRow>(`${USER_SELECT} where u.id = $1 and u.stage = $2`, [input.userId, actor.stage]);
    const target = targetRows[0];
    if (!target) throw new AppError("Utente non trovato.", 404);
    if (String(target.id) === actor.id && input.disabled) throw new AppError("Non puoi disabilitare il tuo utente.");
    const group = await q("select id from groups where id = $1 and stage = $2", [input.groupId, actor.stage]);
    if (!group.length) throw new AppError("Gruppo non valido.");
    const mapped = mapViewer(target);
    if (mapped.role === "administrator" && !mapped.isSample && !mapped.disabled && (input.disabled || input.role !== "administrator")) {
      const others = await q<{ n: unknown }>(
        `select count(*) as n from users
         where stage = $1 and role_id = 'administrator' and disabled = false and is_sample = false and id <> $2`,
        [actor.stage, target.id],
      );
      if (asInt(others[0]?.n) === 0) throw new AppError("Deve restare almeno un amministratore attivo.");
    }
    await q(
      "update users set role_id = $1, group_id = $2, disabled = $3, updated_at = now() where id = $4 and stage = $5",
      [input.role, input.groupId, input.disabled, target.id, actor.stage],
    );
  });
}

export async function countSamples(stage: Stage): Promise<number> {
  const rows = await sql<{ n: unknown }>("select count(*) as n from tasks where stage = $1 and is_sample = true", [stage]);
  return asInt(rows[0]?.n);
}

export async function removeSampleData(actor: Viewer): Promise<void> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può eliminare i dati di esempio.", 403);
  await withTransaction(async (q) => {
    await q(
      `update tasks set author_id = $2, updated_at = now()
       where stage = $1 and is_sample = false
         and author_id in (select id from users where stage = $1 and is_sample = true)`,
      [actor.stage, actor.id],
    );
    await q(
      `delete from comments
       where stage = $1 and author_id in (select id from users where stage = $1 and is_sample = true)`,
      [actor.stage],
    );
    await q(
      `delete from task_assignments
       where stage = $1 and user_id in (select id from users where stage = $1 and is_sample = true)`,
      [actor.stage],
    );
    await q("delete from tasks where stage = $1 and is_sample = true", [actor.stage]);
    await q("delete from users where stage = $1 and is_sample = true", [actor.stage]);
  });
}

export async function ensureSampleData(viewer: Viewer): Promise<void> {
  await withTransaction(async (q) => {
    await q("select pg_advisory_xact_lock(hashtext($1)::bigint)", [`assegna-seed:${viewer.stage}`]);
    const existing = await q("select 1 from app_settings where stage = $1 and key = 'samples_seeded'", [viewer.stage]);
    if (existing.length) return;
    await seedSamples(q, viewer);
    await q("insert into app_settings (stage, key, value) values ($1, 'samples_seeded', '1')", [viewer.stage]);
  });
}

async function seedSamples(q: Query, viewer: Viewer): Promise<void> {
  const today = todayRome();
  async function addUser(sub: string, email: string, name: string, role: RoleId): Promise<string> {
    const rows = await q<{ id: string }>(
      `insert into users (stage, identity_sub, email, identity_name, display_name, role_id, group_id, is_sample)
       values ($1, $2, $3, $4, $4, $5, $6, true)
       on conflict (stage, identity_sub) do update set display_name = excluded.display_name
       returning id`,
      [viewer.stage, sub, email, name, role, viewer.groupId],
    );
    return String(rows[0]?.id);
  }

  const giulia = await addUser("sample:giulia", "giulia.ferraro@example.com", "Giulia Ferraro", "manager");
  const luca = await addUser("sample:luca", "luca.bianchi@example.com", "Luca Bianchi", "user");
  const sara = await addUser("sample:sara", "sara.conti@example.com", "Sara Conti", "user");

  async function addTask(input: {
    title: string;
    description: string;
    authorId: string;
    status: StatusId;
    priority: "low" | "normal" | "high" | "critical";
    progress: number;
    start: string | null;
    deadline: string | null;
    daysAgo: number;
    assignees: { id: string; accepted?: boolean }[];
  }): Promise<string> {
    const rows = await q<{ id: string }>(
      `insert into tasks (
         stage, title, description, author_id, status_id, priority, progress, planned_start, deadline,
         completed_at, group_id, is_sample, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         case when $5 in ('completed', 'closed') then now() - interval '1 day' else null end,
         $10, true, now() - ($11::int * interval '1 day'), now() - ($11::int * interval '1 day')
       ) returning id`,
      [
        viewer.stage,
        input.title,
        input.description,
        input.authorId,
        input.status,
        input.priority,
        input.progress,
        input.start,
        input.deadline,
        viewer.groupId,
        input.daysAgo,
      ],
    );
    const id = String(rows[0]?.id);
    for (const assignee of input.assignees) {
      await q(
        `insert into task_assignments (stage, task_id, user_id, assigned_by, accepted_at)
         values ($1, $2, $3, $4, case when $5::boolean then now() - interval '2 days' else null end)`,
        [viewer.stage, id, assignee.id, input.authorId, Boolean(assignee.accepted)],
      );
    }
    await q(
      `insert into task_history (stage, task_id, actor_id, action, detail)
       values ($1, $2, $3, 'created', '{}'::jsonb)`,
      [viewer.stage, id, input.authorId],
    );
    return id;
  }

  const proposal = await addTask({
    title: "Preparare la proposta commerciale",
    description: "Bozza per il cliente Nord, con prezzi, tempi e ipotesi di avvio.",
    authorId: giulia,
    status: "assigned",
    priority: "high",
    progress: 0,
    start: today,
    deadline: addDays(today, 2),
    daysAgo: 1,
    assignees: [{ id: viewer.id }],
  });
  const checklist = await addTask({
    title: "Migrare le checklist di onboarding",
    description: "Portare le checklist nel nuovo spazio e segnare i punti ancora aperti.",
    authorId: viewer.id,
    status: "wip",
    priority: "normal",
    progress: 45,
    start: addDays(today, -5),
    deadline: addDays(today, 8),
    daysAgo: 5,
    assignees: [{ id: viewer.id, accepted: true }, { id: luca, accepted: true }],
  });
  await addTask({
    title: "Report ore di ottobre",
    description: "Consolidare le ore e lasciare il riepilogo pronto per la chiusura.",
    authorId: viewer.id,
    status: "completed",
    priority: "low",
    progress: 100,
    start: addDays(today, -20),
    deadline: addDays(today, -2),
    daysAgo: 18,
    assignees: [{ id: giulia, accepted: true }],
  });
  await addTask({
    title: "Sbloccare l'accesso al repository",
    description: "Manca il permesso di scrittura per il gruppo che deve pubblicare la patch.",
    authorId: giulia,
    status: "blocked",
    priority: "critical",
    progress: 20,
    start: addDays(today, -1),
    deadline: addDays(today, 1),
    daysAgo: 2,
    assignees: [{ id: viewer.id }, { id: sara }],
  });
  await addTask({
    title: "Chiudere le fatture in scadenza",
    description: "Verificare le fatture aperte e segnalare quelle già oltre la data.",
    authorId: giulia,
    status: "assigned",
    priority: "high",
    progress: 0,
    start: addDays(today, -3),
    deadline: addDays(today, -1),
    daysAgo: 4,
    assignees: [{ id: viewer.id }],
  });
  await addTask({
    title: "Bozza del piano interno",
    description: "Appunti non ancora condivisi con il gruppo.",
    authorId: viewer.id,
    status: "draft",
    priority: "normal",
    progress: 0,
    start: null,
    deadline: null,
    daysAgo: 0,
    assignees: [],
  });
  await addTask({
    title: "Pianificare il kickoff",
    description: "Fissare ordine del giorno, partecipanti e materiale.",
    authorId: giulia,
    status: "accepted",
    priority: "normal",
    progress: 10,
    start: addDays(today, 1),
    deadline: addDays(today, 14),
    daysAgo: 2,
    assignees: [{ id: luca, accepted: true }],
  });

  await q(
    `insert into comments (stage, task_id, author_id, body, created_at)
     values ($1, $2, $3, $4, now() - interval '1 day')`,
    [viewer.stage, checklist, luca, "Ho spostato le prime dieci voci. Restano i controlli di sicurezza."],
  );
  await q(
    `insert into task_history (stage, task_id, actor_id, action, detail, created_at)
     values ($1, $2, $3, 'commented', '{}'::jsonb, now() - interval '1 day')`,
    [viewer.stage, checklist, luca],
  );

  await q(
    `insert into notifications (stage, user_id, task_id, kind, title, body, dedupe_key)
     values ($1, $2, $3, 'assigned', $4, $5, $6)`,
    [
      viewer.stage,
      viewer.id,
      proposal,
      "Nuovo task assegnato",
      "Giulia Ferraro ti ha assegnato «Preparare la proposta commerciale».",
      `event:${randomUUID()}`,
    ],
  );
  await q(
    `insert into notifications (stage, user_id, task_id, kind, title, body, dedupe_key, read_at)
     values ($1, $2, $3, 'comment', $4, $5, $6, now() - interval '20 hours')`,
    [
      viewer.stage,
      viewer.id,
      checklist,
      "Nuovo commento",
      "Luca Bianchi ha commentato «Migrare le checklist di onboarding».",
      `event:${randomUUID()}`,
    ],
  );
}

export async function listEmails(actor: Viewer): Promise<{ id: string; to: string; subject: string; status: string; error: string | null; createdAt: string }[]> {
  if (!canConfigure(actor.role)) throw new AppError("Solo un amministratore può vedere la coda email.", 403);
  const rows = await sql<{ id: string; to_address: string; subject: string; status: string; error: string | null; created_at: unknown }>(
    `select id, to_address, subject, status, error, created_at
     from email_messages
     where stage = $1
     order by created_at desc
     limit 20`,
    [actor.stage],
  );
  return rows.map((row) => ({
    id: String(row.id),
    to: row.to_address,
    subject: row.subject,
    status: row.status,
    error: row.error,
    createdAt: asIso(row.created_at) ?? "",
  }));
}
