import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { openDatabase } from "./database"
import { createDraftStore } from "./drafts"

describe("draft store", () => {
  test("queues documents and reads them back before and after flush", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db, { delay: 1_000 })
    drafts.set("a:draft:prompt", "{}")
    expect(drafts.get("a:draft:prompt")).toBe("{}")
    drafts.flush()
    expect(drafts.get("a:draft:prompt")).toBe("{}")
    drafts.set("a:draft:prompt", null)
    expect(drafts.get("a:draft:prompt")).toBeNull()
    drafts.flush()
    expect(database.db.all(sql`SELECT key FROM document`)).toEqual([])
  })

  test("stores blobs by content hash and collects unreferenced ones on open", () => {
    const database = openDatabase(":memory:")
    const first = createDraftStore(database.db, { delay: 1_000 })
    const used = first.putBlob(new Uint8Array([1, 2, 3]))
    const unused = first.putBlob(new Uint8Array([4, 5, 6]))
    expect(first.putBlob(new Uint8Array([1, 2, 3]))).toBe(used)
    first.set("doc", JSON.stringify({ parts: [{ blob: { id: used } }] }))
    first.flush()
    const second = createDraftStore(database.db, { delay: 1_000 })
    expect(second.getBlob(used)).toEqual(new Uint8Array([1, 2, 3]))
    expect(second.getBlob(unused)).toBeNull()
  })
})
