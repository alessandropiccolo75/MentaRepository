import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { readAllAction } from "@/app/(main)/actions";
import { NOTIFICATION_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { loadSession } from "@/lib/session";
import { listActivity, listNotifications, listPending } from "@/lib/tasks";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  const [notes, pending, activity] = await Promise.all([
    listNotifications(session.viewer),
    listPending(session.viewer),
    listActivity(session.viewer, 8),
  ]);
  const unread = notes.filter((note) => !note.readAt).length;
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>{unread === 0 ? "Nessuna notifica non letta." : `${unread} non lette.`}</p>
        </div>
        {unread > 0 ? (
          <ActionForm action={readAllAction}>
            <SubmitButton variant="secondary">Segna tutte come lette</SubmitButton>
          </ActionForm>
        ) : null}
      </header>
      <section className="panel">
        <div className="panel-head"><h2>Notifiche</h2></div>
        <div className="stack">
          {notes.map((note) => (
            <article className="history-item" key={note.id}>
              <div className="inline">
                <span className="badge">{NOTIFICATION_LABELS[note.kind] ?? "Avviso"}</span>
                {!note.readAt ? <span className="count">Nuova</span> : null}
                <span className="muted">{formatDateTime(note.createdAt)}</span>
              </div>
              <strong>{note.title}</strong>
              <p>{note.body}</p>
              {note.taskId ? <Link href={`/tasks/${note.taskId}?n=${note.id}`}>Apri il task</Link> : null}
            </article>
          ))}
          {notes.length === 0 ? <p className="empty">L'inbox è vuota.</p> : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Nuovi task da prendere in carico</h2></div>
        <div className="stack">
          {pending.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`}>{task.title}</Link>
          ))}
          {pending.length === 0 ? <p className="empty">Nessun task in attesa di presa in carico.</p> : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Attività recente</h2></div>
        <div className="timeline">
          {activity.map((item) => (
            <article key={item.id}>
              <strong>{item.actorName}</strong> · {item.text} · <Link href={`/tasks/${item.taskId}`}>{item.title}</Link>
              <div className="muted">{formatDateTime(item.createdAt)}</div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
