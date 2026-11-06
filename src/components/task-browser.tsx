import Link from "next/link";
import { TaskTable } from "@/components/task-table";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/labels";
import { canCreateTask } from "@/lib/permissions";
import { listAssignable } from "@/lib/directory";
import { loadSession } from "@/lib/session";
import { listTasks } from "@/lib/tasks";
import { PRIORITIES, STATUSES } from "@/lib/types";
import { parseListQuery } from "@/lib/validation";

export async function TaskBrowser({
  title,
  subtitle,
  scope,
  searchParams,
}: {
  title: string;
  subtitle: string;
  scope: "all" | "mine";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await loadSession();
  if (!session.ok) return null;
  const query = parseListQuery(await searchParams);
  const [tasks, people] = await Promise.all([
    listTasks(session.viewer, { scope, query }),
    listAssignable(session.viewer),
  ]);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {canCreateTask(session.viewer.role) ? <Link className="button" href="/tasks/new">Nuovo task</Link> : null}
      </header>
      <form className="filters" method="get">
        <label className="field grow">
          <span>Ricerca</span>
          <input name="q" defaultValue={query.q} maxLength={80} placeholder="Titolo o descrizione" />
        </label>
        <label className="field">
          <span>Stato</span>
          <select name="status" defaultValue={query.status}>
            <option value="">Tutti</option>
            {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Priorità</span>
          <select name="priority" defaultValue={query.priority}>
            <option value="">Tutte</option>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
          </select>
        </label>
        {people.length ? (
          <label className="field">
            <span>Assegnatario</span>
            <select name="assignee" defaultValue={query.assigneeId}>
              <option value="">Tutti</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>Ordine</span>
          <select name="sort" defaultValue={query.sort}>
            <option value="updated">Ultima modifica</option>
            <option value="deadline">Scadenza</option>
            <option value="priority">Priorità</option>
            <option value="title">Titolo</option>
            <option value="created">Creazione</option>
          </select>
        </label>
        <button className="button" type="submit">Filtra</button>
        <Link className="button ghost" href={scope === "mine" ? "/my-tasks" : "/tasks"}>Azzera</Link>
      </form>
      <TaskTable tasks={tasks} />
      {tasks.length === 200 ? <p className="muted">Mostrati i primi 200 task. Affina i filtri per restringere.</p> : null}
    </section>
  );
}
