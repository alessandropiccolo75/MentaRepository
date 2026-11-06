"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setStatusAction } from "@/app/(main)/actions";
import { emptyActionState } from "@/lib/action-state";
import { STATUS_LABELS } from "@/lib/labels";
import type { Priority, StatusId } from "@/lib/types";

export type KanbanCard = {
  id: string;
  title: string;
  status: StatusId;
  priority: Priority;
  priorityLabel: string;
  progress: number;
  deadlineLabel: string;
  overdue: boolean;
  people: string;
  allowed: StatusId[];
  isSample: boolean;
};

export function KanbanBoard({ columns }: { columns: { status: StatusId; cards: KanbanCard[] }[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [over, setOver] = useState<StatusId | null>(null);

  async function move(taskId: string, status: StatusId) {
    const form = new FormData();
    form.set("taskId", taskId);
    form.set("status", status);
    const result = await setStatusAction(emptyActionState, form);
    if (result.error) setError(result.error);
    else {
      setError("");
      router.refresh();
    }
  }

  return (
    <div className="stack">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="kanban">
        {columns.map((column) => (
          <section
            className="kanban-col"
            key={column.status}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.status);
            }}
            onDragLeave={() => setOver((current) => (current === column.status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const taskId = event.dataTransfer.getData("text/plain");
              const from = event.dataTransfer.getData("application/x-status");
              if (!taskId || from === column.status) return;
              const card = columns.flatMap((item) => item.cards).find((item) => item.id === taskId);
              if (!card?.allowed.includes(column.status)) {
                setError("Questo passaggio di stato non è consentito.");
                return;
              }
              void move(taskId, column.status);
            }}
            style={over === column.status ? { outline: "2px solid #0b6b62" } : undefined}
          >
            <h2>{STATUS_LABELS[column.status]} <span className="muted">{column.cards.length}</span></h2>
            <div className="stack">
              {column.cards.map((card) => (
                <article
                  className="card"
                  draggable={card.allowed.length > 0}
                  key={card.id}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", card.id);
                    event.dataTransfer.setData("application/x-status", card.status);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <header>
                    <Link href={`/tasks/${card.id}`}>{card.title}</Link>
                    <span className={`badge priority-${card.priority}`}>{card.priorityLabel}</span>
                  </header>
                  <div className="muted">{card.people || "Nessun assegnatario"}{card.isSample ? " · esempio" : ""}</div>
                  <div className={card.overdue ? "overdue" : "muted"}>{card.deadlineLabel}</div>
                  <div className="progress" aria-hidden="true"><span style={{ width: `${card.progress}%` }} /></div>
                  {card.allowed.length ? (
                    <form
                      className="inline"
                      action={async (formData) => {
                        const result = await setStatusAction(emptyActionState, formData);
                        if (result.error) setError(result.error);
                        else {
                          setError("");
                          router.refresh();
                        }
                      }}
                    >
                      <input type="hidden" name="taskId" value={card.id} />
                      <label className="field">
                        <span className="muted">Sposta</span>
                        <select name="status" defaultValue={card.allowed[0]}>
                          {card.allowed.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                        </select>
                      </label>
                      <button className="button secondary" type="submit">Ok</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
