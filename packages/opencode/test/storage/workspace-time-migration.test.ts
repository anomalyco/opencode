import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { readFileSync, readdirSync } from "fs"
import path from "path"

const target = "20260507164347_add_workspace_time"

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

describe("workspace time migration", () => {
  test("migrates existing workspace rows", () => {
    const sqlite = new Database(":memory:")
    const db = drizzle({ client: sqlite })
    const entries = migrations()
    const index = entries.findIndex((entry) => entry.name === target)

    expect(index).toBeGreaterThan(0)

    migrate(db, entries.slice(0, index))
    sqlite.run(
      "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["project_1", "/tmp/project", "git", "project", 1, 1, "[]"],
    )
    sqlite.run(
      "INSERT INTO workspace (id, type, name, branch, directory, extra, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["workspace_1", "local", "main", "main", "/tmp/project", null, "project_1"],
    )

    expect(() => migrate(db, entries.slice(index))).not.toThrow()
    expect(sqlite.query("SELECT time_used FROM workspace WHERE id = ?").get("workspace_1")).toEqual({ time_used: 0 })
  })
})
