import { emptyActionState, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/errors";

export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? emptyActionState;
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    if (error instanceof AppError) return { error: error.message, message: "" };
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
    console.error(`assegna:action:${error instanceof Error ? error.name : "Error"}:${code}`);
    return { error: "Operazione non riuscita. Riprova.", message: "" };
  }
}

function isFrameworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  return String((error as { digest: unknown }).digest).startsWith("NEXT_");
}
