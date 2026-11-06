import type { RoleId, StatusId } from "@/lib/types";

export type AccessActor = {
  id: string;
  role: RoleId;
  groupId: string;
};

export type AccessTask = {
  authorId: string;
  groupId: string;
  status: StatusId;
  assigneeIds: string[];
};

const ASSIGNEE_TARGETS: Record<StatusId, readonly StatusId[]> = {
  draft: [],
  new: [],
  assigned: ["accepted", "wip", "blocked", "completed"],
  accepted: ["wip", "blocked", "completed"],
  wip: ["blocked", "completed"],
  blocked: ["wip", "completed"],
  completed: [],
  closed: [],
  cancelled: [],
};

export function canManageUsers(role: RoleId): boolean {
  return role === "administrator";
}

export function canConfigure(role: RoleId): boolean {
  return role === "administrator";
}

export function canCreateTask(role: RoleId): boolean {
  return role === "administrator" || role === "manager";
}

export function canViewTask(actor: AccessActor, task: AccessTask): boolean {
  if (actor.role === "administrator") return true;
  if (task.authorId === actor.id) return true;
  if (actor.role === "manager" && task.groupId === actor.groupId) return true;
  if (task.status === "draft") return false;
  return task.assigneeIds.includes(actor.id);
}

export function canEditTaskFields(actor: AccessActor, task: AccessTask): boolean {
  if (!canViewTask(actor, task)) return false;
  if (actor.role === "administrator") return true;
  return actor.role === "manager" && task.groupId === actor.groupId;
}

export function canUpdateProgress(actor: AccessActor, task: AccessTask): boolean {
  if (!canViewTask(actor, task)) return false;
  if (canEditTaskFields(actor, task)) return true;
  if (!task.assigneeIds.includes(actor.id)) return false;
  return task.status !== "closed" && task.status !== "cancelled" && task.status !== "draft";
}

export function canComment(actor: AccessActor, task: AccessTask): boolean {
  return canViewTask(actor, task);
}

export function canTransition(actor: AccessActor, task: AccessTask, to: StatusId): boolean {
  if (task.status === to) return false;
  if (!canViewTask(actor, task)) return false;
  if (actor.role === "administrator") return true;
  if (actor.role === "manager" && task.groupId === actor.groupId) return true;
  if (!task.assigneeIds.includes(actor.id)) return false;
  return ASSIGNEE_TARGETS[task.status].includes(to);
}
