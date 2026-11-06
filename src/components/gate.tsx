export function Forbidden() {
  return (
    <section className="page">
      <div className="panel">
        <h1>Accesso non consentito</h1>
        <p>Il tuo ruolo non può aprire questa sezione.</p>
      </div>
    </section>
  );
}

export function SignedOut({ reason }: { reason: "signed_out" | "key" | "disabled" }) {
  const copy = reason === "disabled"
    ? "Un amministratore ha disabilitato il tuo accesso ad Assegna. L'account Cursor non è stato modificato."
    : reason === "key"
      ? "Questa interfaccia è riservata alle persone. Una chiave API non può aprire Assegna."
      : "Assegna si apre con l'account Cursor che ha il permesso di usare l'app. Non c'è una password separata da creare qui.";
  return (
    <main className="signed-out">
      <section className="panel stack">
        <h1>Assegna</h1>
        <p>{copy}</p>
      </section>
    </main>
  );
}
