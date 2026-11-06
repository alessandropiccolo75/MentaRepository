import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { PRIORITY_LABELS, STATUS_LABELS, historyText } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { loadSession } from "@/lib/session";
import { dashboard } from "@/lib/tasks";
import { PRIORITIES, STATUSES } from "@/lib/types";

export const metadata = { title: "Panoramica" };

export default async function DashboardPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  const data = await dashboard(session.viewer);
  const maxStatus = Math.max(1, ...STATUSES.map((status) => data.statusCounts[status]));
  const maxPriority = Math.max(1, ...PRIORITIES.map((priority) => data.priorityCounts[priority]));
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Panoramica</h1>
          <p>Ciao {session.viewer.name}. Qui c'è il lavoro visibile per il tuo ruolo.</p>
        </div>
      </header>
      {session.sampleCount > 0 ? (
        <p className="banner">
          Ci sono task di esempio per provare l'app.
          {session.viewer.role === "administrator" ? " Puoi toglierli da Amministrazione." : ""}
        </p>
      ) : null}
      <div className="stats">
        <article className="stat"><span>Aperti</span><strong>{data.open}</strong></article>
        <article className="stat"><span>In lavorazione</span><strong>{data.wip}</strong></article>
        <article className="stat"><span>Completati</span><strong>{data.completed}</strong></article>
        <article className="stat warn"><span>In scadenza ({data.dueSoonDays} giorni)</span><strong>{data.dueSoon}</strong></article>
        <article className="stat danger"><span>Scaduti</span><strong>{data.overdue}</strong></article>
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head"><h2>Per stato</h2></div>
          <div className="stack">
            {STATUSES.map((status) => (
              <div className="bar-row" key={status} style={{ display: "grid", gridTemplateColumns: "140px 1fr 32px", gap: 8, alignItems: "center" }}>
                <span>{STATUS_LABELS[status]}</span>
                <span className="progress"><span style={{ width: `${(data.statusCounts[status] / maxStatus) * 100}%` }} /></span>
                <strong>{data.statusCounts[status]}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Per priorità</h2></div>
          <div className="stack">
            {PRIORITIES.map((priority) => (
              <div key={priority} className="inline">
                <PriorityBadge priority={priority} />
                <span className="progress" style={{ width: 120 }}><span style={{ width: `${(data.priorityCounts[priority] / maxPriority) * 100}%` }} /></span>
                <strong>{data.priorityCounts[priority]}</strong>
                <span className="muted">{PRIORITY_LABELS[priority]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Aggiornati di recente</h2>
            <Link href="/tasks">Elenco</Link>
          </div>
          <div className="stack">
            {data.recent.map((task) => (
              <div className="inline" key={task.id}>
                <Link href={`/tasks/${task.id}`}>{task.title}</Link>
                <StatusBadge status={task.status} />
              </div>
            ))}
            {data.recent.length === 0 ? <p className="empty">Nessun task visibile.</p> : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Attività</h2></div>
          <div className="timeline">
            {data.activity.map((item) => (
              <article key={item.id}>
                <strong>{item.actorName}</strong> · {item.text} · <Link href={`/tasks/${item.taskId}`}>{item.title}</Link>
                <div className="muted">{formatDateTime(item.createdAt)}</div>
              </article>
            ))}
            {data.activity.length === 0 ? <p className="empty">Ancora nessuna attività.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
