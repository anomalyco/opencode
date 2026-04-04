import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite"
import { Database as BunDatabase } from "bun:sqlite"
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator"
import path from "path"
import { existsSync, readdirSync, readFileSync } from "fs"

describe("SQLite integration", () => {
  let sqlite: InstanceType<typeof BunDatabase>

  beforeAll(() => {
    sqlite = new BunDatabase(":memory:", { create: true })
    const db = drizzleSqlite({ client: sqlite })

    sqlite.exec("PRAGMA foreign_keys = ON")

    // Run SQLite migrations
    const migrationDir = path.join(import.meta.dirname, "../../../migration")
    if (existsSync(migrationDir)) {
      const dirs = readdirSync(migrationDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)

      const entries = dirs
        .map((name) => {
          const file = path.join(migrationDir, name, "migration.sql")
          if (!existsSync(file)) return
          const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
          const timestamp = match
            ? Date.UTC(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4]),
                Number(match[5]),
                Number(match[6]),
              )
            : 0
          return { sql: readFileSync(file, "utf-8"), timestamp, name }
        })
        .filter(Boolean) as { sql: string; timestamp: number; name: string }[]

      entries.sort((a, b) => a.timestamp - b.timestamp)
      migrateSqlite(db, entries)
    }
  })

  afterAll(() => {
    sqlite.close()
  })

  test("can insert and select a project", () => {
    const id = `test-project-${Date.now()}`
    sqlite.exec(
      `INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('${id}', '/tmp/test', ${Date.now()}, ${Date.now()}, '[]')`,
    )

    const rows = sqlite.query(`SELECT * FROM project WHERE id = ?`).all(id) as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].worktree).toBe("/tmp/test")
  })

  test("can insert and select a session", () => {
    const projectId = `test-project-session-${Date.now()}`
    const sessionId = `test-session-${Date.now()}`
    const now = Date.now()

    sqlite.exec(
      `INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('${projectId}', '/tmp/test', ${now}, ${now}, '[]')`,
    )
    sqlite.exec(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('${sessionId}', '${projectId}', 'test-slug', '/tmp', 'Test Session', '2', ${now}, ${now})`,
    )

    const rows = sqlite.query(`SELECT * FROM session WHERE id = ?`).all(sessionId) as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].title).toBe("Test Session")
    expect(rows[0].project_id).toBe(projectId)
  })

  test("cascade delete works - deleting project removes sessions", () => {
    const projectId = `test-cascade-${Date.now()}`
    const sessionId = `test-cascade-session-${Date.now()}`
    const now = Date.now()

    sqlite.exec(
      `INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('${projectId}', '/tmp/test', ${now}, ${now}, '[]')`,
    )
    sqlite.exec(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('${sessionId}', '${projectId}', 'slug', '/tmp', 'Title', '2', ${now}, ${now})`,
    )

    let sessions = sqlite.query(`SELECT * FROM session WHERE id = ?`).all(sessionId) as any[]
    expect(sessions.length).toBe(1)

    sqlite.exec(`DELETE FROM project WHERE id = '${projectId}'`)

    sessions = sqlite.query(`SELECT * FROM session WHERE id = ?`).all(sessionId) as any[]
    expect(sessions.length).toBe(0)
  })

  test("JSON columns work correctly", () => {
    const projectId = `test-json-${Date.now()}`
    const now = Date.now()
    const sandboxes = JSON.stringify(["sandbox1", "sandbox2"])
    const commands = JSON.stringify({ start: "npm run dev" })

    sqlite.exec(
      `INSERT INTO project (id, worktree, time_created, time_updated, sandboxes, commands) VALUES ('${projectId}', '/tmp/test', ${now}, ${now}, '${sandboxes}', '${commands}')`,
    )

    const rows = sqlite.query(`SELECT * FROM project WHERE id = ?`).all(projectId) as any[]
    expect(rows.length).toBe(1)

    const parsed = JSON.parse(rows[0].sandboxes)
    expect(parsed).toEqual(["sandbox1", "sandbox2"])

    const cmds = JSON.parse(rows[0].commands)
    expect(cmds.start).toBe("npm run dev")
  })
})

describe("Postgres integration", () => {
  const PG_URL = process.env.OPENCODE_TEST_PG_URL || "postgres://postgres:test@localhost:5432/opencode_test"
  let client: any

  beforeAll(async () => {
    try {
      const postgres = (await import("postgres")).default
      client = postgres(PG_URL)
      await client`SELECT 1`

      const { drizzle } = await import("drizzle-orm/postgres-js")
      const db = drizzle({ client })

      const { migrate } = await import("drizzle-orm/postgres-js/migrator")
      const migrationsDir = path.join(import.meta.dirname, "../../../migration-pg")
      if (existsSync(migrationsDir)) {
        await migrate(db, { migrationsFolder: migrationsDir })
      }
    } catch (err) {
      console.warn("Postgres not available, skipping Postgres tests:", (err as Error).message)
      client = null
    }
  })

  afterAll(async () => {
    if (client) {
      try {
        await client`DELETE FROM event`
        await client`DELETE FROM event_sequence`
        await client`DELETE FROM session_share`
        await client`DELETE FROM todo`
        await client`DELETE FROM permission`
        await client`DELETE FROM part`
        await client`DELETE FROM message`
        await client`DELETE FROM session`
        await client`DELETE FROM workspace`
        await client`DELETE FROM project`
        await client`DELETE FROM account_state`
        await client`DELETE FROM control_account`
        await client`DELETE FROM account`
      } catch {}
      await client.end()
    }
  })

  test("can insert and select a project", async () => {
    if (!client) return

    const id = `test-pg-project-${Date.now()}`
    const now = Date.now()

    await client`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (${id}, '/tmp/test', ${now}, ${now}, '[]'::jsonb)`

    const rows = await client`SELECT * FROM project WHERE id = ${id}`
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].worktree).toBe("/tmp/test")
  })

  test("can insert and select a session", async () => {
    if (!client) return

    const projectId = `test-pg-session-project-${Date.now()}`
    const sessionId = `test-pg-session-${Date.now()}`
    const now = Date.now()

    await client`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (${projectId}, '/tmp/test', ${now}, ${now}, '[]'::jsonb)`
    await client`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${sessionId}, ${projectId}, 'test-slug', '/tmp', 'Test Session', '2', ${now}, ${now})`

    const rows = await client`SELECT * FROM session WHERE id = ${sessionId}`
    expect(rows.length).toBe(1)
    expect(rows[0].title).toBe("Test Session")
    expect(rows[0].project_id).toBe(projectId)
  })

  test("cascade delete works", async () => {
    if (!client) return

    const projectId = `test-pg-cascade-${Date.now()}`
    const sessionId = `test-pg-cascade-session-${Date.now()}`
    const now = Date.now()

    await client`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (${projectId}, '/tmp/test', ${now}, ${now}, '[]'::jsonb)`
    await client`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${sessionId}, ${projectId}, 'slug', '/tmp', 'Title', '2', ${now}, ${now})`

    let sessions = await client`SELECT * FROM session WHERE id = ${sessionId}`
    expect(sessions.length).toBe(1)

    await client`DELETE FROM project WHERE id = ${projectId}`

    sessions = await client`SELECT * FROM session WHERE id = ${sessionId}`
    expect(sessions.length).toBe(0)
  })

  test("JSONB columns work correctly", async () => {
    if (!client) return

    const projectId = `test-pg-json-${Date.now()}`
    const now = Date.now()
    const sandboxes = ["sandbox1", "sandbox2"]
    const commands = { start: "npm run dev" }

    await client`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes, commands) VALUES (${projectId}, '/tmp/test', ${now}, ${now}, ${JSON.stringify(sandboxes)}::jsonb, ${JSON.stringify(commands)}::jsonb)`

    const rows = await client`SELECT * FROM project WHERE id = ${projectId}`
    expect(rows.length).toBe(1)
    expect(rows[0].sandboxes).toEqual(sandboxes)
    expect(rows[0].commands.start).toBe("npm run dev")
  })

  test("transaction rollback works", async () => {
    if (!client) return

    const projectId = `test-pg-tx-${Date.now()}`
    const now = Date.now()

    try {
      await client.begin(async (tx: any) => {
        await tx`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (${projectId}, '/tmp/test', ${now}, ${now}, '[]'::jsonb)`
        throw new Error("deliberate rollback")
      })
    } catch {}

    const rows = await client`SELECT * FROM project WHERE id = ${projectId}`
    expect(rows.length).toBe(0)
  })
})
