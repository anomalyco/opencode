import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { sql } from "drizzle-orm"
import { openDatabase } from "./database"
import { createStateStore } from "./state"

const roots: string[] = []
// Bun's node:sqlite shim keeps prepared statements alive after close(), which pins the WAL files
// on Windows. Node (and so Electron) finalizes them; tolerate the leftover here only.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

const open = () => {
  const database = openDatabase(":memory:")
  return { db: database.db, store: createStateStore(database.db, { delay: 1_000 }) }
}
const rows = (db: ReturnType<typeof openDatabase>["db"]) =>
  db.all<{ name: string; key: string; value: string }>(sql`SELECT name, key, value FROM state ORDER BY name, key`)

describe("state store", () => {
  test("reads its own queued writes before they reach the database", () => {
    const { db, store } = open()
    store.set("global", "model", "a")
    expect(store.get("global", "model")).toBe("a")
    expect(rows(db)).toEqual([])
    store.flush()
    expect(rows(db)).toEqual([{ name: "global", key: "model", value: "a" }])
    expect(store.get("global", "model")).toBe("a")
  })

  test("delete is visible immediately and removes the row on flush", () => {
    const { db, store } = open()
    store.set("global", "model", "a")
    store.flush()
    store.delete("global", "model")
    expect(store.get("global", "model")).toBeNull()
    expect(store.items("global")).toEqual({})
    store.flush()
    expect(rows(db)).toEqual([])
  })

  test("items merges stored rows with queued changes and update queues a batch", () => {
    const { db, store } = open()
    store.update("w", { tabs: "[]", recent: "{}" }, [])
    store.flush()
    store.update("w", { info: "{}" }, ["recent"])
    expect(store.items("w")).toEqual({ tabs: "[]", info: "{}" })
    expect(store.items("other")).toEqual({})
    store.flush()
    expect(rows(db)).toEqual([
      { name: "w", key: "info", value: "{}" },
      { name: "w", key: "tabs", value: "[]" },
    ])
  })

  test("clear drops a namespace including queued writes and leaves others alone", () => {
    const { db, store } = open()
    store.set("w1", "tabs", "[]")
    store.set("w2", "tabs", "[]")
    store.flush()
    store.set("w1", "recent", "{}")
    store.clear("w1")
    expect(store.get("w1", "recent")).toBeNull()
    store.flush()
    expect(rows(db)).toEqual([{ name: "w2", key: "tabs", value: "[]" }])
  })

  test("a failed flush keeps every acknowledged write until a later flush succeeds", () => {
    const database = openDatabase(":memory:")
    const errors: unknown[] = []
    const store = createStateStore(database.db, { delay: 1_000, onError: (error) => errors.push(error) })
    store.set("w", "tabs", "[1]")
    store.set("w", "recent", "{}")
    database.db.run(sql`DROP TABLE state`)
    store.flush()
    expect(errors).toHaveLength(1)
    expect(store.get("w", "tabs")).toBe("[1]")
    database.db.run(
      sql`CREATE TABLE state (name TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (name, key))`,
    )
    store.set("w", "info", "{}")
    store.flush()
    expect(rows(database.db)).toEqual([
      { name: "w", key: "info", value: "{}" },
      { name: "w", key: "recent", value: "{}" },
      { name: "w", key: "tabs", value: "[1]" },
    ])
  })

  test("survives close and reopen on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-state-"))
    roots.push(root)
    const file = path.join(root, "drafts.sqlite")
    const first = openDatabase(file)
    const store = createStateStore(first.db, { delay: 1_000 })
    store.set("global", "model", "a")
    store.close()
    first.close()
    const second = openDatabase(file)
    expect(createStateStore(second.db).get("global", "model")).toBe("a")
    second.close()
  })

  test("a burst of writes to one key lands as a single upsert", () => {
    const { db, store } = open()
    for (let index = 0; index < 100; index++) store.set("global", "layout", `${index}`)
    store.flush()
    expect(rows(db)).toEqual([{ name: "global", key: "layout", value: "99" }])
  })
})
