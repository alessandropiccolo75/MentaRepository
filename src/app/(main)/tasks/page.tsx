import { TaskBrowser } from "@/components/task-browser";

export const metadata = { title: "Elenco" };

export default function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <TaskBrowser
      title="Elenco"
      subtitle="Tutti i task che il tuo ruolo può vedere."
      scope="all"
      searchParams={searchParams}
    />
  );
}
