import { Forbidden } from "@/components/gate";
import { ActionForm, SubmitButton } from "@/components/form";
import { groupAction, removeSamplesAction, settingsAction } from "@/app/(main)/actions";
import { countSamples, listEmails, listGroups, listRoles } from "@/lib/directory";
import { emailConfigStatus } from "@/lib/mail";
import { formatDateTime } from "@/lib/format";
import { canConfigure } from "@/lib/permissions";
import { loadSession } from "@/lib/session";
import { listActivity } from "@/lib/tasks";

export const metadata = { title: "Amministrazione" };

const PROVIDER_LABEL = { resend: "Resend", smtp: "SMTP", none: "Nessuno: i messaggi restano registrati e non partono" };

export default async function AdminPage() {
  const session = await loadSession();
  if (!session.ok) return null;
  if (!canConfigure(session.viewer.role)) return <Forbidden />;
  const [roles, groups, emails, activity, samples] = await Promise.all([
    listRoles(),
    listGroups(session.viewer),
    listEmails(session.viewer),
    listActivity(session.viewer, 12),
    countSamples(session.viewer.stage),
  ]);
  const email = emailConfigStatus();
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Amministrazione</h1>
          <p>Ruoli, gruppi, preavvisi di scadenza e coda email.</p>
        </div>
      </header>
      <section className="panel stack">
        <h2>Ruoli</h2>
        {roles.map((role) => (
          <article key={role.id}>
            <strong>{role.label}</strong>
            <p>{role.description}</p>
          </article>
        ))}
        <p className="muted">I permessi sono applicati dalle API, non solo dai pulsanti. Un ruolo nuovo non si può inventare da qui: i tre ruoli sono il modello dell'app.</p>
      </section>
      <div className="split">
        <ActionForm action={settingsAction} className="panel stack">
          <h2>Configurazione</h2>
          <label className="field"><span>Nome organizzazione</span><input name="orgName" defaultValue={session.settings.orgName} maxLength={80} required /></label>
          <label className="field"><span>Giorni di preavviso scadenza</span><input name="dueSoonDays" type="number" min={1} max={30} defaultValue={session.settings.dueSoonDays} /></label>
          <SubmitButton>Salva</SubmitButton>
        </ActionForm>
        <section className="panel stack">
          <h2>Email</h2>
          <p>Provider attivo: {PROVIDER_LABEL[email.provider]}</p>
          <p>EMAIL_FROM: {email.from ? "configurata" : "mancante"}</p>
          <p>RESEND_API_KEY: {email.resend ? "configurata" : "mancante"}</p>
          <p>SMTP (host, utente, password): {email.smtp ? "configurato" : "mancante"}</p>
          <p className="muted">I valori restano nelle variabili d'ambiente. Qui si vede solo se sono presenti.</p>
        </section>
      </div>
      <section className="panel stack">
        <h2>Gruppi</h2>
        <ActionForm action={groupAction} className="inline">
          <input type="hidden" name="intent" value="create" />
          <label className="field"><span>Nuovo gruppo</span><input name="name" maxLength={60} required /></label>
          <SubmitButton variant="secondary">Crea</SubmitButton>
        </ActionForm>
        {groups.map((group) => (
          <div className="inline" key={group.id}>
            <ActionForm action={groupAction} className="inline">
              <input type="hidden" name="intent" value="rename" />
              <input type="hidden" name="groupId" value={group.id} />
              <input name="name" defaultValue={group.name} maxLength={60} aria-label={`Nome di ${group.name}`} />
              <SubmitButton variant="ghost">Rinomina</SubmitButton>
            </ActionForm>
            <span className="muted">{group.userCount} utenti · {group.taskCount} task</span>
            {group.userCount === 0 && group.taskCount === 0 ? (
              <ActionForm action={groupAction}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="groupId" value={group.id} />
                <SubmitButton variant="danger">Elimina</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ))}
      </section>
      <section className="panel stack">
        <h2>Dati di esempio</h2>
        <p>{samples > 0 ? `Ci sono ${samples} task di esempio.` : "Non ci sono task di esempio."}</p>
        {samples > 0 ? (
          <ActionForm action={removeSamplesAction} className="stack">
            <label className="inline">
              <input type="checkbox" name="confirm" value="yes" />
              Confermo di voler eliminare i task e gli utenti di esempio.
            </label>
            <SubmitButton variant="danger">Elimina i dati di esempio</SubmitButton>
          </ActionForm>
        ) : null}
      </section>
      <section className="panel stack">
        <h2>Coda email</h2>
        {emails.length === 0 ? <p className="muted">Nessun messaggio registrato.</p> : null}
        {emails.map((message) => (
          <article key={message.id}>
            <strong>{message.subject}</strong>
            <div className="muted">{message.to} · {message.status} · {formatDateTime(message.createdAt)}</div>
            {message.error ? <div>{message.error}</div> : null}
          </article>
        ))}
      </section>
      <section className="panel stack">
        <h2>Audit recente</h2>
        {activity.map((item) => (
          <article key={item.id}>
            <strong>{item.actorName}</strong> · {item.text} — {item.title}
            <div className="muted">{formatDateTime(item.createdAt)}</div>
          </article>
        ))}
      </section>
    </section>
  );
}
