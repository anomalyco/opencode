import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const ADD_COLUMN = "20260507164347_add_workspace_time"
const BACKFILL = "20260509205313_backfill_workspace_time_used"

function migrations() {
  return readdirSync(path.join(import.meta.dirname, "../../migration"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      timestamp: Number(entry.name.split("_")[0]),
      sql: readFileSync(path.join(import.meta.dirname, "../../migration", entry.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

function seedProjectAndWorkspace(sqlite: Database) {
  sqlite.run(
    "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["project_1", "/tmp/project", "git", "project", 1, 1, "[]"],
  )
  sqlite.run(
    "INSERT INTO workspace (id, type, name, branch, directory, extra, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["workspace_1", "local", "main", "main", "/tmp/project", null, "project_1"],
  )
}

function readTimeUsed(sqlite: Database) {
  const row = sqlite
    .query<{ time_used: number }, [string]>("SELECT time_used FROM workspace WHERE id = ?")
    .get("workspace_1")
  return row?.time_used
}

describe("workspace time migration", () => {
  test("backfills workspace.time_used on fresh upgrade", () => {
    const sqlite = new Database(":memory:")
    const db = drizzle({ client: sqlite })
    const entries = migrations()
    const addIndex = entries.findIndex((entry) => entry.name === ADD_COLUMN)
    expect(addIndex).toBeGreaterThan(0)

    migrate(db, entries.slice(0, addIndex))
    seedProjectAndWorkspace(sqlite)

    const before = Math.floor(Date.now() / 1000) * 1000
    expect(() => migrate(db, entries.slice(addIndex))).not.toThrow()
    expect(readTimeUsed(sqlite)).toBeGreaterThanOrEqual(before)
  })

  test("backfills rows that previously migrated to time_used = 0", () => {
    const sqlite = new Database(":memory:")
    const db = drizzle({ client: sqlite })
    const entries = migrations()
    const backfillIndex = entries.findIndex((entry) => entry.name === BACKFILL)
    expect(backfillIndex).toBeGreaterThan(0)

    // simulate a user who already applied the DEFAULT 0 fix shipped in v1.14.43
    migrate(db, entries.slice(0, backfillIndex))
    seedProjectAndWorkspace(sqlite)
    expect(readTimeUsed(sqlite)).toBe(0)

    const before = Math.floor(Date.now() / 1000) * 1000
    expect(() => migrate(db, entries.slice(backfillIndex))).not.toThrow()
    expect(readTimeUsed(sqlite)).toBeGreaterThanOrEqual(before)
  })
})
