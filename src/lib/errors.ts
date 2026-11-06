export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function dbCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "";
}

export function rethrowDb(error: unknown): never {
  const code = dbCode(error);
  if (code === "23505") throw new AppError("Esiste già un elemento con questi dati.");
  if (code === "23514") throw new AppError("I dati non rispettano i vincoli richiesti.");
  if (code === "23503") throw new AppError("Operazione non consentita per i collegamenti esistenti.");
  throw error;
}
