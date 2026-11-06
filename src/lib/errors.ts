export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function rethrowDb(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "23505") throw new AppError("Esiste già un elemento con questi dati.");
  if (code === "23514") throw new AppError("I dati non rispettano i vincoli richiesti.");
  if (code === "23503") throw new AppError("Operazione non consentita per i collegamenti esistenti.");
  throw error;
}
