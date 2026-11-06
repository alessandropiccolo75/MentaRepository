import Link from "next/link";
import { KanbanBoard, type KanbanCard } from "@/components/kanban-board";
import { PRIORITY_LABELS } from "@/lib/labels";
import { canCreateTask, canTransition } from "@/lib/permissions";
import { formatDate, todayRome } from "@/lib/format";
import { loadSession } from "@/lib/session";
import { listTasks } from "@/lib/tasks";
import { STATUSES, type StatusId } from "@/lib/types";

export const metadata = { title: "Kanban" };

const CLOSED = new Set(["completed", "closed", "cancelled", "draft"]);

export default async function KanbanPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  const tasks = await listTasks(session.viewer, {
    scope: "all",
    query: { q: "", status: "", priority: "", assigneeId: "", sort: "updated" },
  });
  const today = todayRome();
  const cards: KanbanCard[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    priorityLabel: PRIORITY_LABELS[task.priority],
    progress: task.progress,
    deadlineLabel: task.deadline ? formatDate(task.deadline) : "Senza scadenza",
    overdue: Boolean(task.deadline && task.deadline < today && !CLOSED.has(task.status)),
    people: task.assignees.map((person) => person.name).join(", "),
    allowed: STATUSES.filter((status) => canTransition(session.viewer, {
      authorId: task.authorId,
      groupId: task.groupId,
      status: task.status,
      assigneeIds: task.assignees.map((person) => person.id),
    }, status)),
    isSample: task.isSample,
  }));
  const columns = STATUSES.map((status) => ({
    status,
    cards: cards.filter((card) => card.status === status),
  }));
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Kanban</h1>
          <p>Trascina una scheda oppure usa il menu Sposta. Il server controlla comunque il permesso.</p>
        </div>
        {canCreateTask(session.viewer.role) ? <Link className="button" href="/tasks/new">Nuovo task</Link> : null}
      </header>
      <KanbanBoard columns={columns satisfies { status: StatusId; cards: KanbanCard[] }[]} />
    </section>
  );
}
