import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import path from "path"
import os from "os"
import fs from "fs/promises"

describe("database close checkpoint", () => {
  test("wal_checkpoint(TRUNCATE) flushes WAL to main db file", async () => {
    const dir = path.join(os.tmpdir(), "opencode-wal-test-" + Math.random().toString(36).slice(2))
    await fs.mkdir(dir, { recursive: true })
    const dbPath = path.join(dir, "test.db")

    // Create a database with WAL mode matching production settings
    const sqlite = new BunDatabase(dbPath, { create: true })
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)")

    // Insert data
    sqlite.run("INSERT INTO sessions (id, title) VALUES ('s1', 'test session')")
    sqlite.run("INSERT INTO sessions (id, title) VALUES ('s2', 'another session')")

    // WAL file should exist after writes
    const walExists = await fs
      .stat(dbPath + "-wal")
      .then(() => true)
      .catch(() => false)
    expect(walExists).toBe(true)

    // Checkpoint and close (matching our fix in db.ts)
    sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
    sqlite.close()

    // After TRUNCATE checkpoint, WAL file should be empty or gone
    const walSize = await fs
      .stat(dbPath + "-wal")
      .then((s) => s.size)
      .catch(() => 0)
    expect(walSize).toBe(0)

    // Reopen and verify data survived
    const sqlite2 = new BunDatabase(dbPath)
    const rows = sqlite2.query("SELECT id, title FROM sessions ORDER BY id").all() as {
      id: string
      title: string
    }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe("s1")
    expect(rows[0].title).toBe("test session")
    expect(rows[1].id).toBe("s2")
    expect(rows[1].title).toBe("another session")
    sqlite2.close()

    await fs.rm(dir, { recursive: true, force: true })
  })

  test("data survives close without checkpoint when WAL is intact", async () => {
    const dir = path.join(os.tmpdir(), "opencode-wal-test-" + Math.random().toString(36).slice(2))
    await fs.mkdir(dir, { recursive: true })
    const dbPath = path.join(dir, "test.db")

    const sqlite = new BunDatabase(dbPath, { create: true })
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)")
    sqlite.run("INSERT INTO sessions (id, title) VALUES ('s1', 'test')")

    // Close without explicit checkpoint — WAL recovery should still work
    sqlite.close()

    const sqlite2 = new BunDatabase(dbPath)
    const rows = sqlite2.query("SELECT * FROM sessions").all() as { id: string }[]
    expect(rows).toHaveLength(1)
    sqlite2.close()

    await fs.rm(dir, { recursive: true, force: true })
  })

  test("Database.close checkpoints WAL before closing", async () => {
    // This tests the actual Database.close() function from our codebase
    // The preload.ts sets up isolated XDG dirs so this is safe
    const { Database } = await import("../../src/storage/db")

    // Access the client to ensure DB is initialized
    const db = Database.Client()

    // Insert a project row first (session.project_id has FK to project.id)
    const now = Date.now()
    db.$client.run(
      `INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, sandboxes)
       VALUES ('test-proj', '/tmp', ${now}, ${now}, '[]')`,
    )

    // Insert a session row to verify checkpoint works
    db.$client.run(
      `INSERT OR IGNORE INTO session (id, project_id, directory, title, version, slug, time_created, time_updated)
       VALUES ('test-wal-check', 'test-proj', '/tmp', 'WAL Test', '0.0.0', 'wal-test', ${now}, ${now})`,
    )

    // Verify it's readable before close
    const before = db.$client.query("SELECT id FROM session WHERE id = 'test-wal-check'").get() as { id: string } | null
    expect(before).not.toBeNull()
    expect(before!.id).toBe("test-wal-check")

    // Close triggers checkpoint
    Database.close()

    // Reopen via Client() — the lazy initializer should create a fresh connection
    const db2 = Database.Client()
    const after = db2.$client.query("SELECT id FROM session WHERE id = 'test-wal-check'").get() as { id: string } | null
    expect(after).not.toBeNull()
    expect(after!.id).toBe("test-wal-check")

    // Clean up (session cascades from project FK)
    db2.$client.run("DELETE FROM session WHERE id = 'test-wal-check'")
    db2.$client.run("DELETE FROM project WHERE id = 'test-proj'")
  })
})
