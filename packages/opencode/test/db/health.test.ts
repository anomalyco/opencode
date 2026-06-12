import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { generateDoctorReport, generateRepairPlan } from "@opencode-ai/core/database/health"
import { applyRepairPlan } from "@opencode-ai/core/database/repair"

const cleanup: string[] = []

afterEach(() => {
  cleanup.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe("database doctor and repair", () => {
  test("reports a missing database without creating it", async () => {
    const dir = tempDir()
    const dbPath = join(dir, "missing.db")

    const report = await generateDoctorReport(dbPath)
    const plan = await generateRepairPlan(dbPath)

    expect(report.exitCode).toBe(2)
    expect(plan.exitCode).toBe(2)
    expect(existsSync(dbPath)).toBe(false)
  })

  test("reports a corrupt database as unreadable without throwing", async () => {
    const dbPath = join(tempDir(), "corrupt.db")
    writeFileSync(dbPath, "not a sqlite database")

    const report = await generateDoctorReport(dbPath)
    const plan = await generateRepairPlan(dbPath)
    const apply = await applyRepairPlan(plan)

    expect(report.exitCode).toBe(2)
    expect(report.schemaSupported).toBe(false)
    expect(report.issues[0].code).toBe("database_unreadable")
    expect(plan.exitCode).toBe(2)
    expect(plan.operations).toHaveLength(0)
    expect(plan.warnings[0]).toContain("Database is unreadable")
    expect(apply.success).toBe(false)
    expect(apply.backup.path).toBe("")
  })

  test("detects malformed JSON but does not plan a repair", async () => {
    const fixture = createFixture("malformed")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, fixture.worktree, "title", "1")
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), "{")
    fixture.db.close()

    const report = await generateDoctorReport(fixture.dbPath)
    const plan = await generateRepairPlan(fixture.dbPath)

    expect(report.issues.some((issue) => issue.code === "session_message_malformed_json")).toBe(true)
    expect(plan.operations).toHaveLength(0)
  })

  test("dry-run is read-only and plans assistant/session metadata repair", async () => {
    const fixture = createFixture("safe-plan")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1")
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ mode: "build", model: { providerID: "p", modelID: "m" } }))
    fixture.db.close()
    const before = statSync(fixture.dbPath).mtimeMs

    const plan = await generateRepairPlan(fixture.dbPath)

    expect(plan.exitCode).toBe(1)
    expect(plan.operations.map((operation) => operation.issueCode).sort()).toEqual([
      "assistant_message_missing_agent",
      "session_agent_missing",
      "session_model_missing",
      "session_path_missing",
    ])
    expect(statSync(fixture.dbPath).mtimeMs).toBe(before)
    expect(existsSync(`${fixture.dbPath}.backup`)).toBe(false)
  })

  test("apply creates a backup, repairs in a transaction, and is idempotent", async () => {
    const fixture = createFixture("apply")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1")
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ mode: "build", model: { providerID: "p", modelID: "m" } }))
    fixture.db.close()

    const result = await applyRepairPlan(await generateRepairPlan(fixture.dbPath))
    const second = await generateRepairPlan(fixture.dbPath)
    const db = new BunDatabase(fixture.dbPath, { readonly: true })
    const message = JSON.parse((db.query("SELECT data FROM session_message WHERE id = ?").get("msg") as { data: string }).data) as { agent: string }
    const session = db.query("SELECT agent, model, path FROM session WHERE id = ?").get("ses") as { agent: string; model: string; path: string }
    db.close()

    expect(result.success).toBe(true)
    expect(result.backup.path).toContain(".backup.")
    expect(existsSync(result.backup.path)).toBe(true)
    expect(message.agent).toBe("build")
    expect(session.agent).toBe("build")
    expect(session.model).toBe(JSON.stringify({ providerID: "p", modelID: "m" }))
    expect(session.path).toBe(fixture.worktree)
    expect(second.operations).toHaveLength(0)
  })

  test("rollback leaves rows unchanged when a precondition fails", async () => {
    const fixture = createFixture("rollback")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1")
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ mode: "build" }))
    fixture.db.close()
    const plan = await generateRepairPlan(fixture.dbPath)
    const db = new BunDatabase(fixture.dbPath)
    db.query("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify({ mode: "build", agent: "changed" }), "msg")
    db.close()

    const result = await applyRepairPlan(plan)
    const check = new BunDatabase(fixture.dbPath, { readonly: true })
    const data = JSON.parse((check.query("SELECT data FROM session_message WHERE id = ?").get("msg") as { data: string }).data) as { agent: string }
    const session = check.query("SELECT agent FROM session WHERE id = ?").get("ses") as { agent: string | null }
    check.close()

    expect(result.success).toBe(false)
    expect(data.agent).toBe("changed")
    expect(session.agent).toBeNull()
  })

  test("session metadata apply revalidates derivation sources", async () => {
    const fixture = createFixture("metadata-drift")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1")
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ mode: "build" }))
    fixture.db.close()
    const plan = await generateRepairPlan(fixture.dbPath)
    const db = new BunDatabase(fixture.dbPath)
    db.query("UPDATE session_message SET data = ? WHERE id = ?").run(JSON.stringify({ mode: "review" }), "msg")
    db.close()

    const result = await applyRepairPlan(plan)
    const check = new BunDatabase(fixture.dbPath, { readonly: true })
    const session = check.query("SELECT agent FROM session WHERE id = ?").get("ses") as { agent: string | null }
    check.close()

    expect(result.success).toBe(false)
    expect(result.error).toContain("derivation changed")
    expect(session.agent).toBeNull()
  })

  test("directory mismatch is aggressive-only and refuses missing targets", async () => {
    const fixture = createFixture("directory")
    const stale = join(fixture.dir, "stale")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", stale, stale, "title", "1")
    fixture.db.close()

    expect((await generateRepairPlan(fixture.dbPath, "safe")).operations.some((operation) => operation.issueCode === "directory_mismatch")).toBe(false)
    expect((await generateRepairPlan(fixture.dbPath, "aggressive")).operations.some((operation) => operation.issueCode === "directory_mismatch")).toBe(true)

    rmSync(fixture.worktree, { recursive: true, force: true })
    expect((await generateRepairPlan(fixture.dbPath, "aggressive")).operations.some((operation) => operation.issueCode === "directory_mismatch")).toBe(false)
  })

  test("aggressive directory repair applies, is idempotent, and fails on precondition drift", async () => {
    const fixture = createFixture("directory-apply")
    const stale = join(fixture.dir, "stale")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", stale, stale, "title", "1")
    fixture.db.close()

    const result = await applyRepairPlan(await generateRepairPlan(fixture.dbPath, "aggressive"))
    const second = await generateRepairPlan(fixture.dbPath, "aggressive")
    const db = new BunDatabase(fixture.dbPath, { readonly: true })
    const session = db.query("SELECT directory FROM session WHERE id = ?").get("ses") as { directory: string }
    db.close()

    expect(result.success).toBe(true)
    expect(session.directory).toBe(fixture.worktree)
    expect(second.operations.some((operation) => operation.issueCode === "directory_mismatch")).toBe(false)

    const drift = createFixture("directory-drift")
    const driftStale = join(drift.dir, "stale")
    drift.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", drift.worktree, "[]")
    drift.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", driftStale, driftStale, "title", "1")
    drift.db.close()
    const plan = await generateRepairPlan(drift.dbPath, "aggressive")
    const driftDb = new BunDatabase(drift.dbPath)
    driftDb.query("UPDATE session SET directory = ? WHERE id = ?").run("changed", "ses")
    driftDb.close()
    expect((await applyRepairPlan(plan)).success).toBe(false)
  })

  test("directory mismatch refuses symlink, cross-platform, and subdirectory targets", async () => {
    const symlinkFixture = createFixture("directory-symlink")
    const link = join(symlinkFixture.dir, "link-worktree")
    symlinkSync(symlinkFixture.worktree, link, "junction")
    symlinkFixture.db.query("UPDATE project SET worktree = ? WHERE id = ?").run(link, "missing")
    symlinkFixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", link, "[]")
    symlinkFixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", join(symlinkFixture.dir, "stale"), join(symlinkFixture.dir, "stale"), "title", "1")
    symlinkFixture.db.close()
    expect((await generateRepairPlan(symlinkFixture.dbPath, "aggressive")).operations).toHaveLength(0)

    const cross = createFixture("directory-cross")
    cross.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", "/mnt/c/project", "[]")
    cross.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", "C:\\project", "C:\\project", "title", "1")
    cross.db.close()
    expect((await generateRepairPlan(cross.dbPath, "aggressive")).operations).toHaveLength(0)

    const sub = createFixture("directory-sub")
    sub.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", sub.worktree, "[]")
    sub.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", join(sub.worktree, "nested"), join(sub.worktree, "nested"), "title", "1")
    sub.db.close()
    expect((await generateRepairPlan(sub.dbPath, "aggressive")).operations).toHaveLength(0)
  })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-db-doctor-"))
  cleanup.push(dir)
  return dir
}

function createFixture(name: string) {
  const dir = tempDir()
  const worktree = join(dir, `${name}-worktree`)
  mkdirSync(worktree)
  const dbPath = join(dir, `${name}.db`)
  const db = new BunDatabase(dbPath)
  db.exec(`
    CREATE TABLE project (
      id text PRIMARY KEY,
      worktree text NOT NULL,
      vcs text,
      name text,
      icon_url text,
      icon_url_override text,
      icon_color text,
      time_created integer NOT NULL DEFAULT 0,
      time_updated integer NOT NULL DEFAULT 0,
      time_initialized integer,
      sandboxes text NOT NULL,
      commands text
    );
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      workspace_id text,
      parent_id text,
      slug text NOT NULL,
      directory text NOT NULL,
      path text,
      title text NOT NULL,
      version text NOT NULL,
      share_url text,
      summary_additions integer,
      summary_deletions integer,
      summary_files integer,
      summary_diffs text,
      metadata text,
      cost real NOT NULL DEFAULT 0,
      tokens_input integer NOT NULL DEFAULT 0,
      tokens_output integer NOT NULL DEFAULT 0,
      tokens_reasoning integer NOT NULL DEFAULT 0,
      tokens_cache_read integer NOT NULL DEFAULT 0,
      tokens_cache_write integer NOT NULL DEFAULT 0,
      revert text,
      permission text,
      agent text,
      model text,
      time_created integer NOT NULL DEFAULT 0,
      time_updated integer NOT NULL DEFAULT 0,
      time_compacting integer,
      time_archived integer
    );
    CREATE TABLE session_message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      type text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `)
  return { dir, worktree, dbPath, db }
}
