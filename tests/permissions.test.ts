import assert from "node:assert/strict";
import { test } from "node:test";
import { canCreateTask, canEditTaskFields, canTransition, canViewTask } from "../src/lib/permissions.ts";

const user = { id: "u", role: "user" as const, groupId: "g1" };
const manager = { id: "m", role: "manager" as const, groupId: "g1" };
const admin = { id: "a", role: "administrator" as const, groupId: "g1" };
const task = {
  authorId: "m",
  groupId: "g1",
  status: "assigned" as const,
  assigneeIds: ["u"],
};

test("roles and transitions follow the matrix", () => {
  assert.equal(canCreateTask("user"), false);
  assert.equal(canCreateTask("manager"), true);
  assert.equal(canCreateTask("administrator"), true);
  assert.equal(canViewTask(user, task), true);
  assert.equal(canViewTask(user, { ...task, status: "draft" }), false);
  assert.equal(canViewTask(manager, { ...task, status: "draft" }), true);
  assert.equal(canViewTask(manager, { ...task, authorId: "other", groupId: "g2" }), false);
  assert.equal(canViewTask(admin, { ...task, groupId: "g2", status: "draft" }), true);
  assert.equal(canEditTaskFields(user, task), false);
  assert.equal(canEditTaskFields(manager, task), true);
  assert.equal(canTransition(user, task, "accepted"), true);
  assert.equal(canTransition(user, task, "closed"), false);
  assert.equal(canTransition(user, task, "cancelled"), false);
  assert.equal(canTransition(manager, task, "closed"), true);
  assert.equal(canTransition(user, { ...task, assigneeIds: [] }, "wip"), false);
});
