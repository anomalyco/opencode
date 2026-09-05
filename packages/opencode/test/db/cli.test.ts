import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runDoctorCommand, runRepairCommand } from "../../src/cli/cmd/db-runner"

const cleanup: string[] = []

afterEach(() => {
  cleanup.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe("opencode db CLI doctor and repair", () => {
  test("doctor human/json output and approved exit codes", async () => {
    const healthy = createFixture("healthy")
    healthy.db.close()
    const healthyResult = await capture(() => runDoctorCommand(healthy.dbPath, { json: false }))
    expect(healthyResult.exitCode).toBe(0)
    expect(healthyResult.stdout).toContain("Target OpenCode:")
    expect(healthyResult.stdout).toContain("Target migration:")
    expect(healthyResult.stdout).toContain("Supported repairs:")
    expect(healthyResult.stdout).toContain("part_legacy_id_prefix")
    expect(healthyResult.stdout).toContain("No changes were made.")

    const broken = createFixture("broken")
    insertRepairableAssistantIssue(broken)
    const brokenJson = await capture(() => runDoctorCommand(broken.dbPath, { json: true }))
    expect(brokenJson.exitCode).toBe(1)
    expect(JSON.parse(brokenJson.stdout).issues.some((issue: { code: string }) => issue.code === "assistant_message_missing_agent")).toBe(true)
    expect(JSON.parse(brokenJson.stdout).supportedRepairs.some((repair: { code: string }) => repair.code === "part_legacy_id_prefix")).toBe(true)

    const missing = join(tempDir(), "missing.db")
    const missingResult = await capture(() => runDoctorCommand(missing, { json: true }))
    expect(missingResult.exitCode).toBe(2)
    expect(existsSync(missing)).toBe(false)
    expect(JSON.parse(missingResult.stdout).issues[0].code).toBe("database_not_found")
  })

  test("repair dry-run/apply CLI output, JSON, and no-write/apply behavior", async () => {
    const fixture = createFixture("repair")
    insertRepairableAssistantIssue(fixture)
    const before = statSync(fixture.dbPath).mtimeMs

    const dryRun = await capture(() => runRepairCommand(fixture.dbPath, { dryRun: true, apply: false, json: false }))
    const dryRunJson = await capture(() => runRepairCommand(fixture.dbPath, { dryRun: true, apply: false, json: true }))

    expect(dryRun.exitCode).toBe(1)
    expect(dryRun.stdout).toContain("Target OpenCode:")
    expect(dryRun.stdout).toContain("Target migration:")
    expect(dryRun.stdout).toContain("No changes were made.")
    expect(dryRun.stdout).toContain("Supported repairs:")
    expect(dryRun.stdout).toContain("repair_assistant_agent_msg")
    expect(JSON.parse(dryRunJson.stdout).operations[0].issueCode).toBe("assistant_message_missing_agent")
    expect(JSON.parse(dryRunJson.stdout).supportedRepairs.some((repair: { code: string }) => repair.code === "part_legacy_id_prefix")).toBe(true)
    expect(statSync(fixture.dbPath).mtimeMs).toBe(before)
    expect(await hasBackup(fixture.dbPath)).toBe(false)

    const apply = await capture(() => runRepairCommand(fixture.dbPath, { apply: true, json: false }))
    const db = new BunDatabase(fixture.dbPath, { readonly: true })
    const data = JSON.parse((db.query("SELECT data FROM session_message WHERE id = ?").get("msg") as { data: string }).data) as { agent: string }
    db.close()

    expect(apply.exitCode).toBe(0)
    expect(apply.stdout).toContain("Backup created:")
    expect(data.agent).toBe("build")
    expect(await hasBackup(fixture.dbPath)).toBe(true)
  })

  test("corrupt database returns controlled exit code for doctor, dry-run, and apply", async () => {
    const dbPath = join(tempDir(), "corrupt.db")
    writeFileSync(dbPath, "not a sqlite database")

    const doctor = await capture(() => runDoctorCommand(dbPath, { json: true }))
    const dryRun = await capture(() => runRepairCommand(dbPath, { dryRun: true, apply: false, json: true }))
    const apply = await capture(() => runRepairCommand(dbPath, { apply: true, json: true }))

    expect(doctor.exitCode).toBe(2)
    expect(JSON.parse(doctor.stdout).issues[0].code).toBe("database_unreadable")
    expect(dryRun.exitCode).toBe(2)
    expect(JSON.parse(dryRun.stdout).warnings[0]).toContain("Database is unreadable")
    expect(apply.exitCode).toBe(2)
    expect(JSON.parse(apply.stdout).success).toBe(false)
    expect(await hasBackup(dbPath)).toBe(false)
  })

})

async function capture(run: () => Promise<{ exitCode: 0 | 1 | 2 }>) {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "))
  }
  try {
    return { ...(await run()), stdout: lines.join("\n") }
  } finally {
    console.log = original
  }
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-db-cli-"))
  cleanup.push(dir)
  return dir
}

function createFixture(name: string) {
  const dir = tempDir()
  const worktree = join(dir, `${name}-worktree`)
  mkdirSync(worktree)
  const dbPath = join(dir, `${name}.db`)
  const db = new BunDatabase(dbPath)
  createSchema(db)
  return { dir, worktree, dbPath, db }
}

function insertRepairableAssistantIssue(fixture: ReturnType<typeof createFixture>) {
  fixture.db.query("INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)").run("proj", fixture.worktree, "[]")
  fixture.db
    .query("INSERT INTO session (id, project_id, slug, directory, title, version, path, agent, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("ses", "proj", "slug", fixture.worktree, "title", "1", fixture.worktree, "build", JSON.stringify({ providerID: "p", modelID: "m" }))
  fixture.db
    .query("INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run("msg", "ses", "assistant", Date.now(), Date.now(), JSON.stringify({ mode: "build" }))
  fixture.db.close()
}

async function hasBackup(dbPath: string) {
  return Array.from(new Bun.Glob(`${dbPath}.backup.*`).scanSync()).length > 0
}

function createSchema(db: BunDatabase) {
  db.exec(`
    CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, sandboxes text NOT NULL);
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      slug text NOT NULL,
      directory text NOT NULL,
      path text,
      title text NOT NULL,
      version text NOT NULL,
      agent text,
      model text,
      time_created integer NOT NULL DEFAULT 0,
      time_updated integer NOT NULL DEFAULT 0
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
}
