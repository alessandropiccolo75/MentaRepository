"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { emptyActionState, type ActionState } from "@/lib/action-state";

export function SubmitButton({
  children,
  variant = "primary",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const { pending } = useFormStatus();
  const className = variant === "primary" ? "button" : `button ${variant}`;
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? "Attendere…" : children}
    </button>
  );
}

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, emptyActionState);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="form-ok" role="status">{state.message}</p> : null}
    </form>
  );
}
