import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { formatDate, todayRome } from "@/lib/format";
import type { TaskSummary } from "@/lib/types";

const CLOSED = new Set(["completed", "closed", "cancelled", "draft"]);

export function TaskTable({ tasks }: { tasks: TaskSummary[] }) {
  const today = todayRome();
  if (!tasks.length) return <p className="empty">Nessun task con questi filtri.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Stato</th>
            <th>Priorità</th>
            <th>Persone</th>
            <th>Scadenza</th>
            <th>Avanzamento</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const overdue = Boolean(task.deadline && task.deadline < today && !CLOSED.has(task.status));
            return (
              <tr key={task.id}>
                <td>
                  <Link href={`/tasks/${task.id}`}>{task.title}</Link>
                  <div className="muted">{task.groupName}{task.isSample ? " · esempio" : ""}</div>
                </td>
                <td><StatusBadge status={task.status} /></td>
                <td><PriorityBadge priority={task.priority} /></td>
                <td>{task.assignees.map((person) => person.name).join(", ") || "—"}</td>
                <td className={overdue ? "overdue" : undefined}>{formatDate(task.deadline)}</td>
                <td>
                  <div className="inline">
                    <span className="progress" aria-hidden="true"><span style={{ width: `${task.progress}%` }} /></span>
                    <span>{task.progress}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
