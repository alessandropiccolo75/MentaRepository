import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AppError } from "../src/lib/errors.ts";
import { chooseProvider } from "../src/lib/mail.ts";
import { parseTaskForm, slugify } from "../src/lib/validation.ts";

const GROUP = "00000000-0000-4000-8000-000000000001";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

test("task form rejects bad priority, progress and dates", () => {
  const base = { title: "Preparare il verbale", description: "Note", priority: "normal", progress: "10", status: "new", groupId: GROUP };
  assert.equal(parseTaskForm(form(base)).title, "Preparare il verbale");
  assert.throws(() => parseTaskForm(form({ ...base, title: "  " })), AppError);
  assert.throws(() => parseTaskForm(form({ ...base, priority: "urgent" })), AppError);
  assert.throws(() => parseTaskForm(form({ ...base, progress: "101" })), AppError);
  assert.throws(() => parseTaskForm(form({ ...base, plannedStart: "2026-11-10", deadline: "2026-11-01" })), AppError);
});

test("slug and email provider stay predictable", () => {
  assert.equal(slugify("Team Vendite"), "team-vendite");
  assert.equal(chooseProvider({ from: false, resendKey: true, smtpReady: true }), "none");
  assert.equal(chooseProvider({ from: true, resendKey: true, smtpReady: true }), "resend");
  assert.equal(chooseProvider({ from: true, resendKey: false, smtpReady: true }), "smtp");
  assert.equal(chooseProvider({ from: true, resendKey: false, smtpReady: false }), "none");
});

test("schema does not store passwords", async () => {
  const sql = await readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8");
  assert.equal(/password/i.test(sql), false);
});
