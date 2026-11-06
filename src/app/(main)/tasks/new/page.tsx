import { Forbidden } from "@/components/gate";
import { ActionForm, SubmitButton } from "@/components/form";
import { createTaskAction } from "@/app/(main)/actions";
import { listAssignable, listGroups } from "@/lib/directory";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/labels";
import { canCreateTask } from "@/lib/permissions";
import { loadSession } from "@/lib/session";
import { PRIORITIES, STATUSES } from "@/lib/types";

export const metadata = { title: "Nuovo task" };

export default async function NewTaskPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  if (!canCreateTask(session.viewer.role)) return <Forbidden />;
  const [people, groups] = await Promise.all([
    listAssignable(session.viewer),
    session.viewer.role === "administrator" ? listGroups(session.viewer) : Promise.resolve([]),
  ]);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Nuovo task</h1>
          <p>Se lo stato è Nuovo e aggiungi persone, diventa Assegnato. Una bozza non invia notifiche.</p>
        </div>
      </header>
      <ActionForm action={createTaskAction} className="panel stack">
        <label className="field">
          <span>Titolo</span>
          <input name="title" required maxLength={200} />
        </label>
        <label className="field">
          <span>Descrizione</span>
          <textarea name="description" maxLength={8000} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Priorità</span>
            <select name="priority" defaultValue="normal">
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Stato</span>
            <select name="status" defaultValue="new">
              {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Avanzamento</span>
            <input name="progress" type="number" min={0} max={100} defaultValue={0} />
          </label>
          <label className="field">
            <span>Inizio previsto</span>
            <input name="plannedStart" type="date" />
          </label>
          <label className="field">
            <span>Scadenza</span>
            <input name="deadline" type="date" />
          </label>
          {session.viewer.role === "administrator" ? (
            <label className="field">
              <span>Gruppo</span>
              <select name="groupId" defaultValue={session.viewer.groupId}>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
          ) : <input type="hidden" name="groupId" value={session.viewer.groupId} />}
        </div>
        <fieldset className="check-list">
          <legend>Assegnatari</legend>
          {people.map((person) => (
            <label key={person.id}>
              <input type="checkbox" name="assignees" value={person.id} />
              <span>{person.name}{person.isSample ? " (esempio)" : ""} · {person.groupName}</span>
            </label>
          ))}
          {people.length === 0 ? <p className="muted">Nessuna persona assegnabile.</p> : null}
        </fieldset>
        <SubmitButton>Crea task</SubmitButton>
      </ActionForm>
    </section>
  );
}
