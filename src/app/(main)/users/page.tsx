import { Forbidden } from "@/components/gate";
import { ActionForm, SubmitButton } from "@/components/form";
import { memberAction } from "@/app/(main)/actions";
import { listGroups, listMembers } from "@/lib/directory";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { canManageUsers } from "@/lib/permissions";
import { loadSession } from "@/lib/session";
import { ROLES } from "@/lib/types";

export const metadata = { title: "Utenti" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await loadSession();
  if (!session.ok) return null;
  if (!canManageUsers(session.viewer.role)) return <Forbidden />;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const [members, groups] = await Promise.all([
    listMembers(session.viewer, q.trim().slice(0, 80)),
    listGroups(session.viewer),
  ]);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Utenti</h1>
          <p>Le persone compaiono al primo accesso con Cursor. Qui assegni ruolo, gruppo e disabilitazione.</p>
        </div>
      </header>
      <form className="filters" method="get">
        <label className="field grow"><span>Ricerca</span><input name="q" defaultValue={q} maxLength={80} /></label>
        <button className="button" type="submit">Cerca</button>
      </form>
      <div className="stack">
        {members.map((member) => (
          <ActionForm action={memberAction} className="panel" key={member.id}>
            <input type="hidden" name="userId" value={member.id} />
            <div className="form-grid">
              <div>
                <strong>{member.name}</strong>
                <div className="muted">{member.email || "Email non disponibile"}</div>
                <div className="muted">Visto: {formatDateTime(member.lastSeenAt)}{member.isSample ? " · esempio, non può accedere" : ""}</div>
              </div>
              <label className="field">
                <span>Ruolo</span>
                <select name="role" defaultValue={member.role}>
                  {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Gruppo</span>
                <select name="groupId" defaultValue={member.groupId}>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Accesso all'app</span>
                <select name="account" defaultValue={member.disabled ? "disabled" : "active"}>
                  <option value="active">Attivo</option>
                  <option value="disabled">Disabilitato</option>
                </select>
              </label>
              <SubmitButton variant="secondary">Salva</SubmitButton>
            </div>
          </ActionForm>
        ))}
      </div>
    </section>
  );
}
