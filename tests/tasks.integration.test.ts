import assert from "node:assert/strict";
import { test } from "node:test";
import { resetLocalDatabase, sql } from "../src/lib/db.ts";
import { createGroup, listGroups, updateMember, upsertViewer } from "../src/lib/directory.ts";
import { AppError } from "../src/lib/errors.ts";
import { addDays, todayRome } from "../src/lib/format.ts";
import {
  addComment,
  createTask,
  dashboard,
  getTask,
  listNotifications,
  listTasks,
  markRead,
  setStatus,
  syncDeadlines,
  updateTask,
} from "../src/lib/tasks.ts";
import type { TaskInput, Viewer } from "../src/lib/types.ts";

function input(viewer: Viewer, patch: Partial<TaskInput> = {}): TaskInput {
  return {
    title: "Allineare il verbale",
    description: "Punti aperti della riunione",
    priority: "high",
    progress: 0,
    plannedStart: todayRome(),
    deadline: addDays(todayRome(), 4),
    status: "new",
    assigneeIds: [],
    groupId: viewer.groupId,
    ...patch,
  };
}

test("authorization, history, notifications and stage isolation", async () => {
  await resetLocalDatabase();
  const ada = await upsertViewer({ stage: "production", sub: "user:100", email: "ada@example.com", name: "Ada Admin" });
  const marco = await upsertViewer({ stage: "production", sub: "user:200", email: "marco@example.com", name: "Marco Manager" });
  const lia = await upsertViewer({ stage: "production", sub: "user:300", email: "lia@example.com", name: "Lia Lavoro" });
  const ugo = await upsertViewer({ stage: "production", sub: "user:400", email: "ugo@example.com", name: "Ugo Utente" });
  assert.equal(ada.role, "administrator");
  assert.equal(marco.role, "user");

  await createGroup(ada, "Vendite");
  const vendite = (await listGroups(ada)).find((group) => group.slug === "vendite");
  assert.ok(vendite);
  await updateMember(ada, { userId: marco.id, role: "manager", groupId: vendite.id, disabled: false });
  await updateMember(ada, { userId: lia.id, role: "user", groupId: vendite.id, disabled: false });
  const manager = { ...marco, role: "manager" as const, groupId: vendite.id, groupName: "Vendite" };
  const worker = { ...lia, role: "user" as const, groupId: vendite.id, groupName: "Vendite" };

  await assert.rejects(() => createTask(ugo, input(ugo)), (error: unknown) => error instanceof AppError);
  const taskId = await createTask(manager, input(manager, { assigneeIds: [worker.id], groupId: ada.groupId }));
  const stored = await getTask(ada, taskId);
  assert.ok(stored);
  assert.equal(stored.groupId, vendite.id);
  assert.equal(stored.status, "assigned");
  assert.equal(await getTask(ugo, taskId), null);
  await assert.rejects(() => updateTask(worker, taskId, input(manager, { title: "Titolo cambiato", assigneeIds: [worker.id], groupId: vendite.id, status: "assigned" })), AppError);
  await assert.rejects(() => setStatus(worker, taskId, "closed"), AppError);

  await setStatus(worker, taskId, "accepted");
  const accepted = await getTask(worker, taskId);
  assert.equal(accepted?.status, "accepted");
  assert.ok(accepted?.assignees.find((person) => person.id === worker.id)?.acceptedAt);
  const notes = await listNotifications(worker);
  assert.ok(notes.some((note) => note.kind === "assigned"));
  const adaNotes = await listNotifications(ada);
  assert.equal(adaNotes.length, 0);

  await addComment(worker, taskId, "Ho iniziato dal primo punto.");
  const afterComment = await listNotifications(manager);
  assert.ok(afterComment.some((note) => note.kind === "comment"));
  await assert.rejects(() => addComment(ugo, taskId, "Non dovrei"), AppError);

  const emails = await sql<{ status: string }>("select status from email_messages where stage = 'production'");
  assert.ok(emails.length >= 1);
  assert.ok(emails.every((row) => row.status === "skipped"));

  const draftId = await createTask(manager, input(manager, { title: "Bozza interna", status: "draft", assigneeIds: [worker.id], groupId: vendite.id }));
  assert.equal(await getTask(worker, draftId), null);
  assert.ok(await getTask(manager, draftId));

  const overdueId = await createTask(manager, input(manager, {
    title: "Fatture scadute",
    assigneeIds: [worker.id],
    groupId: vendite.id,
    deadline: addDays(todayRome(), -1),
    plannedStart: addDays(todayRome(), -3),
    status: "assigned",
  }));
  await syncDeadlines(worker);
  await syncDeadlines(worker);
  const overdue = (await listNotifications(worker)).filter((note) => note.kind === "overdue" && note.taskId === overdueId);
  assert.equal(overdue.length, 1);
  await markRead(ugo, overdue[0].id);
  const stillUnread = await sql<{ read_at: string | null }>("select read_at from notifications where id = $1", [overdue[0].id]);
  assert.equal(stillUnread[0]?.read_at ?? null, null);
  await markRead(worker, overdue[0].id);
  const read = await sql<{ read_at: string | null }>("select read_at from notifications where id = $1", [overdue[0].id]);
  assert.ok(read[0]?.read_at);

  const board = await dashboard(ada);
  assert.ok(board.open >= 1);
  assert.ok(board.overdue >= 1);
  assert.equal(board.statusCounts.assigned + board.statusCounts.accepted + board.statusCounts.draft + board.statusCounts.wip >= 1, true);

  await assert.rejects(() => updateMember(ada, { userId: ada.id, role: "user", groupId: ada.groupId, disabled: false }), AppError);
  await updateMember(ada, { userId: ugo.id, role: "administrator", groupId: ada.groupId, disabled: false });
  await updateMember(ada, { userId: ada.id, role: "user", groupId: ada.groupId, disabled: false });

  const preview = await upsertViewer({ stage: "preview", sub: "user:100", email: "ada@example.com", name: "Ada Admin" });
  assert.equal(preview.role, "administrator");
  const previewTask = await createTask(preview, input(preview, { title: "Solo anteprima" }));
  const storedStage = await sql<{ stage: string }>("select stage from tasks where id = $1", [previewTask]);
  assert.equal(storedStage[0]?.stage, "preview");
  assert.equal((await getTask(preview, previewTask))?.title, "Solo anteprima");
  assert.equal(await getTask({ ...ada, role: "administrator" }, previewTask), null);
});
