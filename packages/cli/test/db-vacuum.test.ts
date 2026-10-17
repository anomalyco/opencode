import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compactDatabase } from "../src/commands/handlers/db/maintenance"

test("vacuum converts an existing database and reclaims deleted pages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-db-vacuum-"))
  const filename = join(dir, "legacy.db")
  const database = new Database(filename)
  let databaseClosed = false
  try {
    database.exec("CREATE TABLE history (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
    const insert = database.prepare("INSERT INTO history (id, payload) VALUES (?, ?)")
    for (let id = 0; id < 1_400; id++) insert.run(id, Buffer.alloc(4_096))
    database.exec("DELETE FROM history")
    expect(Number(database.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()?.freelist_count)).toBeGreaterThan(1_024)
    database.close()
    databaseClosed = true

    const result = compactDatabase(filename)
    expect(result.afterBytes).toBeLessThan(result.beforeBytes)

    const compacted = new Database(filename, { readonly: true })
    try {
      expect(compacted.query<{ auto_vacuum: number }, []>("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 2 })
      expect(Number(compacted.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()?.freelist_count)).toBe(0)
    } finally {
      compacted.close()
    }
  } finally {
    if (!databaseClosed) {
      if (database.inTransaction) database.run("ROLLBACK")
      database.close()
    }
    await rm(dir, { recursive: true, force: true })
  }
})
