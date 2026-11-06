import { ActionForm, SubmitButton } from "@/components/form";
import { profileAction } from "@/app/(main)/actions";
import { ROLE_LABELS } from "@/lib/labels";
import { loadSession } from "@/lib/session";

export const metadata = { title: "Profilo" };

export default async function ProfilePage() {
  const session = await loadSession();
  if (!session.ok) return null;
  const viewer = session.viewer;
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Profilo</h1>
          <p>{ROLE_LABELS[viewer.role]} · {viewer.groupName}</p>
        </div>
      </header>
      <section className="panel stack">
        <h2>Account</h2>
        <p>L'accesso è quello di Cursor. Assegna non chiede e non conserva una password: al primo ingresso viene creato il profilo applicativo, collegato alla persona già autenticata.</p>
        <p>Uscita, cambio password e recupero password si fanno dall'account Cursor con cui apri l'app. Disabilitare un utente qui blocca solo Assegna.</p>
        <p><strong>Email:</strong> {viewer.email || "Non indicata dall'account"}</p>
        <p><strong>Nome dell'account:</strong> {viewer.identityName || "Non indicato"}</p>
      </section>
      <ActionForm action={profileAction} className="panel stack">
        <h2>Nome visualizzato</h2>
        <label className="field">
          <span>Come ti vedono gli altri in Assegna</span>
          <input name="displayName" defaultValue={viewer.displayName ?? ""} maxLength={80} placeholder={viewer.identityName || viewer.email} />
        </label>
        <SubmitButton>Salva profilo</SubmitButton>
      </ActionForm>
    </section>
  );
}
