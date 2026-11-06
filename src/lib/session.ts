import { cache } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getIdentity } from "../../cursor/identity.js";
import { countSamples, ensureSampleData, getSettings, upsertViewer } from "@/lib/directory";
import { AppError } from "@/lib/errors";
import { syncDeadlines, unreadCount } from "@/lib/tasks";
import type { Settings, Stage, Viewer } from "@/lib/types";

export type ReadySession = {
  ok: true;
  viewer: Viewer;
  unread: number;
  simulated: boolean;
  stage: Stage;
  settings: Settings;
  sampleCount: number;
};

export type LoadResult = ReadySession | { ok: false; reason: "signed_out" | "key" | "disabled" };

export const loadSession = cache(async (): Promise<LoadResult> => {
  await connection();
  const headerList = await headers();
  const identity = await getIdentity(headerList);
  if (!identity || identity.verified !== true) return { ok: false, reason: "signed_out" };
  if (identity.kind !== "person") return { ok: false, reason: "key" };
  const stage: Stage = identity.stage === "preview" ? "preview" : "production";
  const viewer = await upsertViewer({
    stage,
    sub: String(identity.sub ?? ""),
    email: String(identity.email ?? ""),
    name: String(identity.name ?? ""),
  });
  if (viewer.disabled) return { ok: false, reason: "disabled" };
  await ensureSampleData(viewer);
  await syncDeadlines(viewer);
  const [unread, settings, sampleCount] = await Promise.all([
    unreadCount(viewer),
    getSettings(viewer.stage),
    countSamples(viewer.stage),
  ]);
  return {
    ok: true,
    viewer,
    unread,
    simulated: identity.simulated === true,
    stage,
    settings,
    sampleCount,
  };
});

export async function requireSession(): Promise<ReadySession> {
  const session = await loadSession();
  if (!session.ok) {
    throw new AppError(
      session.reason === "disabled" ? "Il tuo accesso è stato disabilitato." : "Accesso richiesto.",
      session.reason === "disabled" ? 403 : 401,
    );
  }
  return session;
}
