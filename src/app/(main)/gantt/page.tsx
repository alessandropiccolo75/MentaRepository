import { GanttChart } from "@/components/gantt-chart";
import { loadSession } from "@/lib/session";
import { listTasks } from "@/lib/tasks";

export const metadata = { title: "Gantt" };

export default async function GanttPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  const tasks = await listTasks(session.viewer, {
    scope: "all",
    query: { q: "", status: "", priority: "", assigneeId: "", sort: "deadline" },
  });
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Gantt</h1>
          <p>Inizio, scadenza, stato e avanzamento dei task visibili.</p>
        </div>
      </header>
      <GanttChart tasks={tasks} />
    </section>
  );
}
