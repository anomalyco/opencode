import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { $ } from "bun"
import { tmpdir } from "../fixture/fixture"
import { Effect } from "effect"

Log.init({ print: false })

function run<A>(fn: (svc: Project.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Project.Service
      return yield* fn(svc)
    }).pipe(Effect.provide(Project.defaultLayer)),
  )
}

function uid() {
  return SessionID.make(crypto.randomUUID())
}

function seed(opts: { id: SessionID; dir: string; project: ProjectID }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
        slug: opts.id,
        directory: opts.dir,
        title: "test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function ensureGlobal() {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectID.global,
        worktree: "/",
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

describe("migrateFromGlobal", () => {
  test("migrates global sessions on first project creation", async () => {
    // 1. Start with git init but no commits — creates "global" project row
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()
    await $`git config user.name "Test"`.cwd(tmp.path).quiet()
    await $`git config user.email "test@opencode.test"`.cwd(tmp.path).quiet()
    await $`git config commit.gpgsign false`.cwd(tmp.path).quiet()
    const { project: pre } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(pre.id).toBe(ProjectID.global)

    // 2. Seed a session under "global" with matching directory
    const id = uid()
    seed({ id, dir: tmp.path, project: ProjectID.global })

    // 3. Make a commit so the project gets a real ID
    await $`git commit --allow-empty -m "root"`.cwd(tmp.path).quiet()

    const { project: real } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(real.id).not.toBe(ProjectID.global)

    // 4. The session should have been migrated to the real project ID
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(real.id)
  })

  test("migrates global sessions even when project row already exists", async () => {
    // 1. Create a repo with a commit — real project ID created immediately
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    // 2. Ensure "global" project row exists (as it would from a prior no-git session)
    ensureGlobal()

    // 3. Seed a session under "global" with matching directory.
    //    This simulates a session created before git init that wasn't
    //    present when the real project row was first created.
    const id = uid()
    seed({ id, dir: tmp.path, project: ProjectID.global })

    // 4. Call fromDirectory again — project row already exists,
    //    so the current code skips migration entirely. This is the bug.
    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(project.id)
  })

  test("does not claim sessions with empty directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    ensureGlobal()

    // Legacy sessions may lack a directory value.
    // Without a matching origin directory, they should remain global.
    const id = uid()
    seed({ id, dir: "", project: ProjectID.global })

    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(ProjectID.global)
  })

  test("does not steal sessions from unrelated directories", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    ensureGlobal()

    // Seed a session under "global" but for a DIFFERENT directory
    const id = uid()
    seed({ id, dir: "/some/other/dir", project: ProjectID.global })

    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    // Should remain under "global" — not stolen
    expect(row!.project_id).toBe(ProjectID.global)
  })
})
