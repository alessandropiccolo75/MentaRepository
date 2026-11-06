import { Shell } from "@/components/shell";
import { SignedOut } from "@/components/gate";
import { loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const session = await loadSession();
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
