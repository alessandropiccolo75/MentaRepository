export const STAGES = ["production", "preview"] as const;
export type Stage = (typeof STAGES)[number];

export const ROLES = ["administrator", "manager", "user"] as const;
export type RoleId = (typeof ROLES)[number];

export const STATUSES = [
  "draft",
  "new",
  "assigned",
  "accepted",
  "wip",
  "blocked",
  "completed",
  "closed",
  "cancelled",
] as const;
export type StatusId = (typeof STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Viewer = {
  id: string;
  stage: Stage;
  email: string;
  identityName: string;
  displayName: string | null;
  name: string;
  role: RoleId;
  groupId: string;
  groupName: string;
  disabled: boolean;
  isSample: boolean;
};

export type Assignee = {
  id: string;
  name: string;
  acceptedAt: string | null;
  isSample: boolean;
};

export type TaskSummary = {
  id: string;
  stage: Stage;
  title: string;
  excerpt: string;
  authorId: string;
  authorName: string;
  status: StatusId;
  priority: Priority;
  progress: number;
  plannedStart: string | null;
  deadline: string | null;
  completedAt: string | null;
  closedAt: string | null;
  groupId: string;
  groupName: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  assignees: Assignee[];
};

export type TaskDetail = TaskSummary & {
  description: string;
};

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  isSample: boolean;
};

export type HistoryEntry = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorName: string;
};

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type Member = {
  id: string;
  email: string;
  name: string;
  role: RoleId;
  groupId: string;
  groupName: string;
  disabled: boolean;
  isSample: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Group = {
  id: string;
  slug: string;
  name: string;
  userCount: number;
  taskCount: number;
};

export type Settings = {
  orgName: string;
  dueSoonDays: number;
};

export type TaskInput = {
  title: string;
  description: string;
  priority: Priority;
  progress: number;
  plannedStart: string | null;
  deadline: string | null;
  status: StatusId;
  assigneeIds: string[];
  groupId: string;
};

export function isRole(value: string): value is RoleId {
  return (ROLES as readonly string[]).includes(value);
}

export function isStatus(value: string): value is StatusId {
  return (STATUSES as readonly string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export function isStage(value: string): value is Stage {
  return value === "production" || value === "preview";
}
