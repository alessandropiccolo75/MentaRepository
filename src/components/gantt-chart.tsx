import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { addDays, daysBetween, formatDate, todayRome } from "@/lib/format";
import type { TaskSummary } from "@/lib/types";

export function GanttChart({ tasks }: { tasks: TaskSummary[] }) {
  const today = todayRome();
  const dated = tasks.flatMap((task) => {
    const start = task.plannedStart ?? task.deadline;
    const end = task.deadline ?? task.plannedStart;
    if (!start || !end) return [];
    return [{ task, start: start < end ? start : end, end: end > start ? end : start }];
  });
  const undated = tasks.filter((task) => !task.plannedStart && !task.deadline);
  if (!dated.length) return <p className="empty">Nessun task con date di inizio o scadenza.</p>;
  const min = addDays(dated.reduce((value, item) => (item.start < value ? item.start : value), dated[0].start), -1);
  const max = addDays(dated.reduce((value, item) => (item.end > value ? item.end : value), dated[0].end), 1);
  const total = Math.max(1, daysBetween(min, max));
  const todayLeft = today >= min && today <= max ? (daysBetween(min, today) / total) * 100 : null;
  return (
    <div className="stack">
      <p className="muted">Dal {formatDate(min)} al {formatDate(max)}. La linea rossa è oggi.</p>
      <div className="gantt">
        {dated.map(({ task, start, end }) => (
          <div className="gantt-row" key={task.id}>
            <div>
              <Link href={`/tasks/${task.id}`}>{task.title}</Link>
              <div className="muted">{formatDate(start)} – {formatDate(end)}</div>
            </div>
            <div className="track" aria-hidden="true">
              {todayLeft != null ? <span className="today" style={{ left: `${todayLeft}%` }} /> : null}
              <span
                className={`gantt-bar status-${task.status}`}
                style={{
                  left: `${(daysBetween(min, start) / total) * 100}%`,
                  width: `${Math.max(2, (Math.max(1, daysBetween(start, end)) / total) * 100)}%`,
                  background: "currentColor",
                }}
                title={`${task.progress}%`}
              />
            </div>
          </div>
        ))}
      </div>
      {undated.length ? (
        <section className="panel">
          <h2>Senza date</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            {undated.map((task) => (
              <div className="inline" key={task.id}>
                <Link href={`/tasks/${task.id}`}>{task.title}</Link>
                <StatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
