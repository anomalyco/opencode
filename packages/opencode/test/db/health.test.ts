import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SUPPORTED_REPAIRS, generateDoctorReport, generateRepairPlan } from "@opencode-ai/core/database/health"
import { applyRepairPlan } from "@opencode-ai/core/database/repair"

const cleanup: string[] = []

afterEach(() => {
  cleanup.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe("database doctor and repair", () => {
  test("documents the supported repair catalog", () => {
    expect(SUPPORTED_REPAIRS.map((repair) => repair.code).sort()).toEqual([
      "assistant_message_missing_agent",
      "message_assistant_missing_parent",
      "message_user_missing_agent",
      "message_user_missing_model",
      "part_compaction_missing_auto",
      "part_legacy_id_prefix",
      "part_step_finish_missing_reason",
      "part_tool_completed_missing_metadata",
      "part_tool_completed_missing_time",
      "part_tool_completed_missing_title",
      "session_agent_missing",
      "session_model_missing",
      "session_path_missing",
    ])
    expect(SUPPORTED_REPAIRS.find((repair) => repair.code === "part_legacy_id_prefix")?.sourceEvidence).toContain("1.2.21")
    expect(SUPPORTED_REPAIRS.find((repair) => repair.code === "session_path_missing")?.targetMigration).toBe("20260428004200_add_session_path")
    expect(SUPPORTED_REPAIRS.every((repair) => repair.targetOpenCodeVersion.length > 0 && repair.targetInvariant.length > 0)).toBe(true)
  })

  test("reports a missing database without creating it", async () => {
    const dir = tempDir()
    const dbPath = join(dir, "missing.db")

    const report = await generateDoctorReport(dbPath)
    const plan = await generateRepairPlan(dbPath)

    expect(report.exitCode).toBe(2)
    expect(report.compatibility.targetOpenCodeVersion.length).toBeGreaterThan(0)
    expect(report.compatibility.latestExpectedMigration).toBe("20260612174303_project_dir_strategy")
    expect(report.supportedRepairs.some((repair) => repair.code === "part_legacy_id_prefix")).toBe(true)
    expect(plan.exitCode).toBe(2)
    expect(plan.compatibility.targetOpenCodeVersion.length).toBeGreaterThan(0)
    expect(plan.compatibility.latestExpectedMigration).toBe("20260612174303_project_dir_strategy")
    expect(plan.supportedRepairs.some((repair) => repair.code === "part_legacy_id_prefix")).toBe(true)
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

  test("detects malformed message and part JSON without treating the database as unreadable", async () => {
    const fixture = createFixture("malformed-v2")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version, agent, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, fixture.worktree, "title", "1", "build", JSON.stringify({ providerID: "p", modelID: "m" }))
    fixture.db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run("msg", "ses", 1, 1, "{")
    fixture.db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)").run("prt", "msg", "ses", 1, 1, "[]")
    fixture.db.close()

    const report = await generateDoctorReport(fixture.dbPath)
    const plan = await generateRepairPlan(fixture.dbPath)

    expect(report.exitCode).toBe(0)
    expect(report.issues.some((issue) => issue.code === "message_malformed_json")).toBe(true)
    expect(report.issues.some((issue) => issue.code === "part_malformed_json")).toBe(true)
    expect(plan.exitCode).toBe(0)
    expect(plan.operations).toHaveLength(0)
    expect(plan.warnings).toContain("message.data contains malformed JSON")
    expect(plan.warnings).toContain("part.data contains malformed JSON")
  })

  test("ignores malformed assistant messages while deriving user message repairs", async () => {
    const fixture = createFixture("malformed-derive")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, fixture.worktree, "title", "1")
    fixture.db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run("bad", "ses", 1, 1, "{")
    fixture.db
      .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
      .run("user", "ses", 2, 2, JSON.stringify({ role: "user", time: { created: 2 } }))
    fixture.db.close()

    const report = await generateDoctorReport(fixture.dbPath)
    const plan = await generateRepairPlan(fixture.dbPath)

    expect(report.exitCode).toBe(1)
    expect(report.issues.some((issue) => issue.code === "message_malformed_json")).toBe(true)
    expect(report.issues.some((issue) => issue.code === "message_user_missing_agent" && !issue.repairable)).toBe(true)
    expect(plan.exitCode).toBe(1)
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

  test("repairs legacy part id prefixes required by current schemas", async () => {
    const fixture = createFixture("part-prefix")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version, agent, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1", "build", JSON.stringify({ providerID: "p", modelID: "m" }))
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ agent: "build", model: { providerID: "p", modelID: "m" } }))
    fixture.db
      .query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("part_ccf86b97b002MOqoKxDVMesjG9", "msg", "ses", Date.now(), Date.now(), JSON.stringify({ type: "text", text: "hello" }))
    fixture.db.close()

    const report = await generateDoctorReport(fixture.dbPath)
    const plan = await generateRepairPlan(fixture.dbPath)
    const result = await applyRepairPlan(plan)
    const second = await generateRepairPlan(fixture.dbPath)
    const db = new BunDatabase(fixture.dbPath, { readonly: true })
    const rows = db.query("SELECT id FROM part ORDER BY id").all() as { id: string }[]
    db.close()

    expect(report.issues.some((issue) => issue.code === "part_legacy_id_prefix" && issue.repairable)).toBe(true)
    expect(report.compatibility.sessionVersions).toEqual([{ version: "1", count: 1 }])
    expect(plan.operations.map((operation) => operation.issueCode)).toContain("part_legacy_id_prefix")
    expect(result.success).toBe(true)
    expect(rows.map((row) => row.id)).toEqual(["prt_ccf86b97b002MOqoKxDVMesjG9"])
    expect(second.operations).toHaveLength(0)
  })

  test("reports non-repairable legacy part id collisions in repair dry-run", async () => {
    const fixture = createFixture("part-prefix-collision")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, title, version, agent, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, "title", "1", "build", JSON.stringify({ providerID: "p", modelID: "m" }))
    fixture.db
      .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ agent: "build", model: { providerID: "p", modelID: "m" } }))
    fixture.db
      .query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("part_same", "msg", "ses", 1, 1, JSON.stringify({ type: "text", text: "legacy" }))
    fixture.db
      .query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("prt_same", "msg", "ses", 1, 1, JSON.stringify({ type: "text", text: "target" }))
    fixture.db.close()

    const report = await generateDoctorReport(fixture.dbPath)
    const plan = await generateRepairPlan(fixture.dbPath)
    const result = await applyRepairPlan(plan)

    expect(report.exitCode).toBe(1)
    expect(report.issues.some((issue) => issue.code === "part_legacy_id_prefix" && !issue.repairable)).toBe(true)
    expect(plan.exitCode).toBe(1)
    expect(plan.operations.map((operation) => operation.issueCode)).toEqual(["session_path_missing"])
    expect(plan.unrepairableErrors).toContain("part.id uses the legacy part_ prefix, but the target prt_ id already exists")
    expect(plan.warnings).toContain("part.id uses the legacy part_ prefix, but the target prt_ id already exists")
    expect(result.success).toBe(false)
    expect(result.backup.path).toBe("")
  })

  test("repairs missing message and part fields required by current schemas", async () => {
    const fixture = createFixture("message-part-fields")
    fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
    fixture.db
      .query("INSERT INTO session (id, project_id, slug, directory, path, title, version, agent, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("ses", "proj", "slug", fixture.worktree, fixture.worktree, "title", "1", "build", JSON.stringify({ providerID: "p", modelID: "m" }))
    fixture.db
      .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
      .run("msg_user", "ses", 1, 1, JSON.stringify({ role: "user", time: { created: 1 } }))
    fixture.db
      .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
      .run("msg_assistant", "ses", 2, 2, JSON.stringify({ role: "assistant", time: { created: 2 }, agent: "build", providerID: "p", modelID: "m" }))
    fixture.db
      .query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("prt_step", "msg_assistant", "ses", 3, 3, JSON.stringify({ type: "step-finish", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }))
    fixture.db
      .query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("prt_tool", "msg_assistant", "ses", 5, 5, JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed", time: { start: 4 } } }))
    fixture.db.close()

    const plan = await generateRepairPlan(fixture.dbPath)
    const result = await applyRepairPlan(plan)
    const db = new BunDatabase(fixture.dbPath, { readonly: true })
    const user = JSON.parse((db.query("SELECT data FROM message WHERE id = ?").get("msg_user") as { data: string }).data) as { agent: string; model: { providerID: string; modelID: string } }
    const assistant = JSON.parse((db.query("SELECT data FROM message WHERE id = ?").get("msg_assistant") as { data: string }).data) as { parentID: string }
    const part = JSON.parse((db.query("SELECT data FROM part WHERE id = ?").get("prt_step") as { data: string }).data) as { reason: string }
    const tool = JSON.parse((db.query("SELECT data FROM part WHERE id = ?").get("prt_tool") as { data: string }).data) as { state: { metadata: Record<string, unknown>; title: string; time: { start: number; end: number } } }
    db.close()

    expect(plan.operations.map((operation) => operation.issueCode).sort()).toEqual([
      "message_assistant_missing_parent",
      "message_user_missing_agent",
      "message_user_missing_model",
      "part_step_finish_missing_reason",
      "part_tool_completed_missing_metadata",
      "part_tool_completed_missing_time",
      "part_tool_completed_missing_title",
    ])
    expect(result.success).toBe(true)
    expect(user.agent).toBe("build")
    expect(user.model).toEqual({ providerID: "p", modelID: "m" })
    expect(assistant.parentID).toBe("msg_user")
    expect(part.reason).toBe("stop")
    expect(tool.state.metadata).toEqual({})
    expect(tool.state.title).toBe("bash")
    expect(tool.state.time).toEqual({ start: 4, end: 5 })
    expect((await generateRepairPlan(fixture.dbPath)).operations).toHaveLength(0)
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
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `)
  return { dir, worktree, dbPath, db }
}
