import { readdir, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { dbCode } from "@/lib/errors";

pg.types.setTypeParser(1082, (value) => value);

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;
let remoteReady: Promise<void> | undefined;
let local: Promise<PGlite> | undefined;
let queue: Promise<void> = Promise.resolve();

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (databaseUrl !== "") {
    const current = await ensureRemote();
    return (await current.query(text, params)).rows as T[];
  }
  return enqueue(async () => {
    const db = await getLocal();
    return (await db.query<T>(text, params)).rows;
  });
}

export async function withTransaction<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  if (databaseUrl !== "") {
    const current = await ensureRemote();
    const client = await current.connect();
    try {
      await client.query("begin");
      const q: Query = async (text, params = []) => (await client.query(text, params)).rows as never;
      const result = await fn(q);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // The original error is the one to surface.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return enqueue(async () => {
    const db = await getLocal();
    await db.exec("begin");
    try {
      const q: Query = async (text, params = []) => (await db.query(text, params)).rows as never;
      const result = await fn(q);
      await db.exec("commit");
      return result;
    } catch (error) {
      try {
        await db.exec("rollback");
      } catch {
        // Keep the original failure.
      }
      throw error;
    }
  });
}

function getPool(): pg.Pool {
  // statement_timeout is a startup parameter. The hosted pooler rejects it and
  // every query fails, so the limit stays off this connection.
  pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return pool;
}

async function ensureRemote(): Promise<pg.Pool> {
  const current = getPool();
  remoteReady ??= applyRemoteMigrations(current).catch((error: unknown) => {
    remoteReady = undefined;
    console.error(`assegna:db:${error instanceof Error ? error.name : "Error"}:${dbCode(error)}`);
    throw error;
  });
  await remoteReady;
  return current;
}

async function migrationFiles(): Promise<{ name: string; sql: string }[]> {
  const dir = join(process.cwd(), "migrations");
  const names = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  const files: { name: string; sql: string }[] = [];
  for (const name of names) files.push({ name, sql: await readFile(join(dir, name), "utf8") });
  return files;
}

async function applyRemoteMigrations(current: pg.Pool): Promise<void> {
  const probe = await current.query<{ name: string | null }>("select to_regclass('public.users') as name");
  if (probe.rows[0]?.name) return;
  const files = await migrationFiles();
  if (files.length === 0) {
    console.error("assegna:db:migrations-missing");
    return;
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || databaseUrl,
  });
  await client.connect();
  try {
    const again = await client.query<{ name: string | null }>("select to_regclass('public.users') as name");
    if (again.rows[0]?.name) return;
    try {
      await client.query("select pg_advisory_lock(7272741::bigint)");
    } catch (error) {
      console.error(`assegna:db:lock:${dbCode(error)}`);
    }
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map((row) => row.name),
    );
    for (const file of files) {
      if (done.has(file.name)) continue;
      await client.query("begin");
      try {
        await client.query(file.sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file.name]);
        await client.query("commit");
      } catch (error) {
        try {
          await client.query("rollback");
        } catch {
          // Keep the migration error.
        }
        const present = await client.query<{ name: string | null }>("select to_regclass('public.users') as name");
        if (present.rows[0]?.name) return;
        throw error;
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(7272741::bigint)");
    } catch {
      // Closing the connection releases the lock.
    }
    await client.end();
  }
}

async function getLocal(): Promise<PGlite> {
  local ??= startLocal().catch((error: unknown) => {
    local = undefined;
    throw error;
  });
  return local;
}

async function startLocal(): Promise<PGlite> {
  if (process.env.NODE_ENV === "test") {
    const db = new PGlite();
    await applyMigrations(db);
    return db;
  }
  await mkdir(".data", { recursive: true });
  const db = new PGlite(".data/pglite");
  await applyMigrations(db);
  return db;
}

async function applyMigrations(db: PGlite): Promise<void> {
  await db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const files = (await readdir("migrations").catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  const done = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).rows.map((row) => row.name),
  );
  for (const file of files) {
    if (done.has(file)) continue;
    await db.exec("begin");
    try {
      await db.exec(await readFile(`migrations/${file}`, "utf8"));
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
      await db.exec("commit");
    } catch (error) {
      try {
        await db.exec("rollback");
      } catch {
        // Keep the migration error.
      }
      throw error;
    }
  }
}

export async function resetLocalDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("reset only in test");
  if (databaseUrl !== "") throw new Error("refusing to reset a configured database");
  await enqueue(async () => {
    const db = await getLocal();
    await db.exec(`
      drop table if exists email_messages cascade;
      drop table if exists notifications cascade;
      drop table if exists task_history cascade;
      drop table if exists comments cascade;
      drop table if exists task_assignments cascade;
      drop table if exists tasks cascade;
      drop table if exists users cascade;
      drop table if exists groups cascade;
      drop table if exists app_settings cascade;
      drop table if exists task_statuses cascade;
      drop table if exists roles cascade;
      drop table if exists schema_migrations cascade;
    `);
    await applyMigrations(db);
  });
}
