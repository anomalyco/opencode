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

  test("keeps text chunks alive and collects retired ones after a flush once the interval passed", () => {
    const database = openDatabase(":memory:")
    let clock = 0
    const drafts = createDraftStore(database.db, { delay: 1_000, now: () => clock })
    const a = drafts.putBlob(new TextEncoder().encode("chunk a"))
    const b = drafts.putBlob(new TextEncoder().encode("chunk b"))
    drafts.set("doc", JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids: [a, b] } } }] }))
    drafts.flush()
    const c = drafts.putBlob(new TextEncoder().encode("chunk c"))
    drafts.set("doc", JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids: [a, c] } } }] }))
    drafts.flush()
    // Too soon: the retired chunk survives this flush.
    expect(drafts.getBlob(b)).not.toBeNull()
    clock = 120_000
    drafts.putBlob(new TextEncoder().encode("chunk d"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(a)).not.toBeNull()
    expect(drafts.getBlob(c)).not.toBeNull()
    expect(drafts.getBlob(b)).toBeNull()
  })
})
