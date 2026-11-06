"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import {
  createGroup,
  deleteGroup,
  removeSampleData,
  renameGroup,
  saveSettings,
  updateMember,
  updateProfile,
} from "@/lib/directory";
import { runAction } from "@/lib/run-action";
import { requireSession } from "@/lib/session";
import { acceptTask, addComment, createTask, markAllRead, markRead, setProgress, setStatus, updateTask } from "@/lib/tasks";
import { isStatus } from "@/lib/types";
import {
  field,
  parseComment,
  parseDisplayName,
  parseProgress,
  parseRole,
  parseTaskForm,
  parseUuid,
} from "@/lib/validation";

export async function createTaskAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = await createTask(session.viewer, parseTaskForm(form));
    redirect(`/tasks/${id}`);
  });
}

export async function updateTaskAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const taskId = parseUuid(field(form, "taskId"));
    if (!taskId) return { error: "Task non valido.", message: "" };
    await updateTask(session.viewer, taskId, parseTaskForm(form));
    return { error: "", message: "Modifiche salvate." };
  });
}

export async function setStatusAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const taskId = parseUuid(field(form, "taskId"));
    const status = field(form, "status");
    if (!taskId || !isStatus(status)) return { error: "Richiesta non valida.", message: "" };
    await setStatus(session.viewer, taskId, status);
    return { error: "", message: "Stato aggiornato." };
  });
}

export async function acceptTaskAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const taskId = parseUuid(field(form, "taskId"));
    if (!taskId) return { error: "Task non valido.", message: "" };
    await acceptTask(session.viewer, taskId);
    return { error: "", message: "Task preso in carico." };
  });
}

export async function progressAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const taskId = parseUuid(field(form, "taskId"));
    if (!taskId) return { error: "Task non valido.", message: "" };
    await setProgress(session.viewer, taskId, parseProgress(field(form, "progress")));
    return { error: "", message: "Avanzamento aggiornato." };
  });
}

export async function commentAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const taskId = parseUuid(field(form, "taskId"));
    if (!taskId) return { error: "Task non valido.", message: "" };
    await addComment(session.viewer, taskId, parseComment(field(form, "body")));
    return { error: "", message: "Commento aggiunto." };
  });
}

export async function profileAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await updateProfile(session.viewer, parseDisplayName(field(form, "displayName")));
    return { error: "", message: "Profilo aggiornato." };
  });
}

export async function memberAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const userId = parseUuid(field(form, "userId"));
    const groupId = parseUuid(field(form, "groupId"));
    if (!userId || !groupId) return { error: "Utente non valido.", message: "" };
    await updateMember(session.viewer, {
      userId,
      groupId,
      role: parseRole(field(form, "role")),
      disabled: field(form, "account") === "disabled",
    });
    return { error: "", message: "Utente aggiornato." };
  });
}

export async function groupAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const intent = field(form, "intent");
    if (intent === "create") {
      await createGroup(session.viewer, field(form, "name"));
      return { error: "", message: "Gruppo creato." };
    }
    const groupId = parseUuid(field(form, "groupId"));
    if (!groupId) return { error: "Gruppo non valido.", message: "" };
    if (intent === "rename") {
      await renameGroup(session.viewer, groupId, field(form, "name"));
      return { error: "", message: "Gruppo rinominato." };
    }
    if (intent === "delete") {
      await deleteGroup(session.viewer, groupId);
      return { error: "", message: "Gruppo eliminato." };
    }
    return { error: "Richiesta non valida.", message: "" };
  });
}

export async function settingsAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const days = Number(field(form, "dueSoonDays"));
    await saveSettings(session.viewer, { orgName: field(form, "orgName"), dueSoonDays: days });
    return { error: "", message: "Configurazione salvata." };
  });
}

export async function removeSamplesAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    if (field(form, "confirm") !== "yes") return { error: "Conferma l'eliminazione dei dati di esempio.", message: "" };
    await removeSampleData(session.viewer);
    return { error: "", message: "Dati di esempio eliminati." };
  });
}

export async function readNotificationAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    const id = parseUuid(field(form, "notificationId"));
    if (!id) return { error: "Notifica non valida.", message: "" };
    await markRead(session.viewer, id);
    return { error: "", message: "" };
  });
}

export async function readAllAction(_state: ActionState, _form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    await markAllRead(session.viewer);
    return { error: "", message: "Notifiche segnate come lette." };
  });
}
