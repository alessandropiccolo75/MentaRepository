import { TaskBrowser } from "@/components/task-browser";

export const metadata = { title: "I miei task" };

export default function MyTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <TaskBrowser
      title="I miei task"
      subtitle="Task assegnati a te, con filtri, ordinamento e ricerca."
      scope="mine"
      searchParams={searchParams}
    />
  );
}
