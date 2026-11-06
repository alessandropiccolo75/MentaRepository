import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/form";
import {
  acceptTaskAction,
  commentAction,
  progressAction,
  setStatusAction,
  updateTaskAction,
} from "@/app/(main)/actions";
import { listAssignable, listGroups } from "@/lib/directory";
import { formatDate, formatDateTime } from "@/lib/format";
import { PRIORITY_LABELS, STATUS_LABELS, historyText, quickStatuses } from "@/lib/labels";
import { canComment, canEditTaskFields, canTransition, canUpdateProgress } from "@/lib/permissions";
import { loadSession } from "@/lib/session";
import { getTask, listComments, listHistory, markRead } from "@/lib/tasks";
import { PRIORITIES, STATUSES } from "@/lib/types";
import { parseUuid } from "@/lib/validation";

export const metadata = { title: "Task" };

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await loadSession();
  if (!session.ok) return null;
  const { id } = await params;
  const taskId = parseUuid(id);
  if (!taskId) notFound();
  const task = await getTask(session.viewer, taskId);
  if (!task) notFound();
  const query = await searchParams;
  const notificationId = parseUuid(typeof query.n === "string" ? query.n : "");
  if (notificationId) await markRead(session.viewer, notificationId);
  const [comments, history, people, groups] = await Promise.all([
    listComments(session.viewer, task.id),
    listHistory(session.viewer, task.id),
    canEditTaskFields(session.viewer, access(task)) ? listAssignable(session.viewer) : Promise.resolve([]),
    session.viewer.role === "administrator" ? listGroups(session.viewer) : Promise.resolve([]),
  ]);
  const accessTask = access(task);
  const editable = canEditTaskFields(session.viewer, accessTask);
  const mine = task.assignees.find((person) => person.id === session.viewer.id);
  const showAccept = Boolean(mine && !mine.acceptedAt && !["draft", "closed", "cancelled"].includes(task.status));
  const quick = quickStatuses(task.status).filter((item) => canTransition(session.viewer, accessTask, item.status));
  const others = STATUSES.filter((status) => canTransition(session.viewer, accessTask, status) && !quick.some((item) => item.status === status));
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="muted"><Link href="/tasks">Elenco</Link> · {task.groupName}</p>
          <h1>{task.title}</h1>
          <div className="inline" style={{ marginTop: 8 }}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.isSample ? <span className="sample">Dato di esempio</span> : null}
          </div>
        </div>
      </header>
      <div className="split">
        <div className="stack">
          <section className="panel">
            <h2>Descrizione</h2>
            <p className="prose" style={{ marginTop: 8 }}>{task.description || "Nessuna descrizione."}</p>
          </section>
          {editable ? (
            <ActionForm action={updateTaskAction} className="panel stack">
              <h2>Modifica</h2>
              <input type="hidden" name="taskId" value={task.id} />
              <label className="field"><span>Titolo</span><input name="title" defaultValue={task.title} maxLength={200} required /></label>
              <label className="field"><span>Descrizione</span><textarea name="description" defaultValue={task.description} maxLength={8000} /></label>
              <div className="form-grid">
                <label className="field">
                  <span>Priorità</span>
                  <select name="priority" defaultValue={task.priority}>
                    {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Stato</span>
                  <select name="status" defaultValue={task.status}>
                    {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Avanzamento</span>
                  <input name="progress" type="number" min={0} max={100} defaultValue={task.progress} />
                </label>
                <label className="field"><span>Inizio</span><input name="plannedStart" type="date" defaultValue={task.plannedStart ?? ""} /></label>
                <label className="field"><span>Scadenza</span><input name="deadline" type="date" defaultValue={task.deadline ?? ""} /></label>
                {session.viewer.role === "administrator" ? (
                  <label className="field">
                    <span>Gruppo</span>
                    <select name="groupId" defaultValue={task.groupId}>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                ) : <input type="hidden" name="groupId" value={task.groupId} />}
              </div>
              <fieldset className="check-list">
                <legend>Assegnatari</legend>
                {mergePeople(people, task.assignees).map((person) => (
                  <label key={person.id}>
                    <input type="checkbox" name="assignees" value={person.id} defaultChecked={task.assignees.some((item) => item.id === person.id)} />
                    <span>{person.name}{person.isSample ? " (esempio)" : ""}</span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton>Salva</SubmitButton>
            </ActionForm>
          ) : null}
          <section className="panel stack">
            <h2>Commenti</h2>
            {comments.map((comment) => (
              <article className="comment" key={comment.id}>
                <strong>{comment.authorName}</strong>
                <span className="muted"> · {formatDateTime(comment.createdAt)}</span>
                <p>{comment.body}</p>
              </article>
            ))}
            {comments.length === 0 ? <p className="muted">Nessun commento.</p> : null}
            {canComment(session.viewer, accessTask) ? (
              <ActionForm action={commentAction} className="stack">
                <input type="hidden" name="taskId" value={task.id} />
                <label className="field"><span>Nuovo commento</span><textarea name="body" maxLength={4000} required /></label>
                <SubmitButton>Commenta</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
        </div>
        <aside className="stack">
          <section className="panel stack">
            <h2>Avanzamento</h2>
            <div className="progress"><span style={{ width: `${task.progress}%` }} /></div>
            <strong>{task.progress}%</strong>
            {canUpdateProgress(session.viewer, accessTask) && !editable ? (
              <ActionForm action={progressAction} className="inline">
                <input type="hidden" name="taskId" value={task.id} />
                <label className="field"><span>Percentuale</span><input name="progress" type="number" min={0} max={100} defaultValue={task.progress} /></label>
                <SubmitButton variant="secondary">Aggiorna</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
          <section className="panel stack">
            <h2>Date</h2>
            <p>Inizio: {formatDate(task.plannedStart)}</p>
            <p>Scadenza: {formatDate(task.deadline)}</p>
            <p>Completato: {formatDateTime(task.completedAt)}</p>
            <p>Chiuso: {formatDateTime(task.closedAt)}</p>
            <p className="muted">Creato {formatDateTime(task.createdAt)} da {task.authorName}</p>
            <p className="muted">Ultima modifica {formatDateTime(task.updatedAt)}</p>
          </section>
          <section className="panel stack">
            <h2>Persone</h2>
            {task.assignees.length === 0 ? <p className="muted">Nessun assegnatario.</p> : null}
            {task.assignees.map((person) => (
              <p key={person.id}>{person.name}{person.acceptedAt ? " · preso in carico" : " · in attesa"}{person.isSample ? " · esempio" : ""}</p>
            ))}
            <div className="row-actions">
              {showAccept ? (
                <ActionForm action={acceptTaskAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <SubmitButton>Prendi in carico</SubmitButton>
                </ActionForm>
              ) : null}
              {quick.filter((item) => !(showAccept && item.status === "accepted")).map((item) => (
                <ActionForm action={setStatusAction} key={item.status}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="status" value={item.status} />
                  <SubmitButton variant="secondary">{item.label}</SubmitButton>
                </ActionForm>
              ))}
            </div>
            {others.length ? (
              <ActionForm action={setStatusAction} className="inline">
                <input type="hidden" name="taskId" value={task.id} />
                <label className="field">
                  <span>Altro stato</span>
                  <select name="status" defaultValue={others[0]}>
                    {others.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </label>
                <SubmitButton variant="ghost">Sposta</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
          <section className="panel stack">
            <h2>Storico</h2>
            {history.map((entry) => (
              <article className="history-item" key={entry.id}>
                <strong>{entry.actorName}</strong>
                <p>{historyText(entry.action, entry.detail)}</p>
                <span className="muted">{formatDateTime(entry.createdAt)}</span>
              </article>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function access(task: { authorId: string; groupId: string; status: import("@/lib/types").StatusId; assignees: { id: string }[] }) {
  return {
    authorId: task.authorId,
    groupId: task.groupId,
    status: task.status,
    assigneeIds: task.assignees.map((person) => person.id),
  };
}

function mergePeople(
  people: { id: string; name: string; isSample: boolean }[],
  assignees: { id: string; name: string; isSample: boolean }[],
) {
  const map = new Map<string, { id: string; name: string; isSample: boolean }>();
  for (const person of [...assignees, ...people]) map.set(person.id, person);
  return [...map.values()];
}
