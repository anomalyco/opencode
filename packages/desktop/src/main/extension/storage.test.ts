import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { openDatabase, type Database } from "../storage/database"
import { createStateStore } from "../storage/state"
import { createMainStorage } from "./storage"

const roots: string[] = []
// Bun's node:sqlite shim pins the WAL files on Windows after close(); tolerate the leftover here only.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

const open = (db: Database) =>
  createMainStorage(createStateStore(db), "example").store("servers", {
    schema: Schema.Array(Schema.String),
    initial: [],
  })

describe("main extension storage", () => {
  // A crash right after saving keeps the value: another connection reads it without any flush.
  test.each([
    { name: "set", write: (store: ReturnType<typeof open>) => store.set(["a"]), expected: ["a"] },
    {
      name: "remove",
      write: (store: ReturnType<typeof open>) => {
        store.set(["a"])
        store.remove()
      },
      expected: [],
    },
  ])("$name reaches the database before it returns", async (row) => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-extension-storage-"))
    roots.push(root)
    const file = path.join(root, "drafts.sqlite")
    const writer = openDatabase(file)
    const reader = openDatabase(file)
    row.write(open(writer.db))
    expect(open(reader.db).get()).toEqual(row.expected)
    writer.close()
    reader.close()
  })
})
