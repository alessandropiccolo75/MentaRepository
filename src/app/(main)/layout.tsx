import { Shell } from "@/components/shell";
import { SignedOut } from "@/components/gate";
import { dbCode } from "@/lib/errors";
import { loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof loadSession>>;
  try {
    session = await loadSession();
  } catch (error) {
    const code = dbCode(error);
    console.error(`assegna:layout:${error instanceof Error ? error.name : "Error"}:${code}`);
    return (
      <main className="signed-out">
        <section className="panel stack">
          <h1>Qualcosa è andato storto</h1>
          <p>Ricarica la pagina. Se il problema resta, riprova tra qualche istante.</p>
          {code ? <p className="muted">Riferimento {code}</p> : null}
        </section>
      </main>
    );
  }
  if (!session.ok) return <SignedOut reason={session.reason} />;
  return (
    <Shell
      orgName={session.settings.orgName}
      name={session.viewer.name}
      role={session.viewer.role}
      unread={session.unread}
      simulated={session.simulated}
      stage={session.stage}
    >
      {children}
    </Shell>
  );
}
