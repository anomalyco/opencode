import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { openDatabase } from "./database"
import { blobGrace, createDraftStore } from "./drafts"

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

  test("collects a retired chunk only once it is unreferenced and past the grace period", () => {
    const database = openDatabase(":memory:")
    let clock = 0
    const drafts = createDraftStore(database.db, { delay: 1_000, now: () => clock })
    const text = (...ids: string[]) =>
      JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids } } }] })
    const a = drafts.putBlob(new TextEncoder().encode("chunk a"))
    const b = drafts.putBlob(new TextEncoder().encode("chunk b"))
    drafts.set("doc", text(a, b))
    drafts.flush()
    const c = drafts.putBlob(new TextEncoder().encode("chunk c"))
    drafts.set("doc", text(a, c))
    drafts.flush()
    // Retired but recently touched: survives a due collection.
    clock = 120_000
    drafts.putBlob(new TextEncoder().encode("chunk d"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(b)).not.toBeNull()
    // Past the grace period and still unreferenced: collected. Referenced chunks stay.
    clock = 120_000 + blobGrace + 1
    drafts.putBlob(new TextEncoder().encode("chunk e"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(a)).not.toBeNull()
    expect(drafts.getBlob(c)).not.toBeNull()
    expect(drafts.getBlob(b)).toBeNull()
  })

  test("a document that republishes a cached chunk id refreshes the chunk without an upload", () => {
    const database = openDatabase(":memory:")
    let clock = 0
    const drafts = createDraftStore(database.db, { delay: 1_000, now: () => clock })
    const text = (...ids: string[]) =>
      JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids } } }] })
    const a = drafts.putBlob(new TextEncoder().encode("A"))
    drafts.set("doc", text(a))
    drafts.flush()
    // Edit away from A; A becomes unreferenced.
    const b = drafts.putBlob(new TextEncoder().encode("A!"))
    drafts.set("doc", text(b))
    drafts.flush()
    // Long after, undo republishes A from the renderer cache with no upload. The write touches A.
    clock = blobGrace - 1
    drafts.set("doc", text(a))
    drafts.flush()
    clock = blobGrace + collectInterval
    drafts.putBlob(new TextEncoder().encode("unrelated"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(a)).not.toBeNull()
    expect(drafts.getBlob(b)).toBeNull()
  })

  test("an uploaded attachment survives a due collection before its document is written", () => {
    const database = openDatabase(":memory:")
    let clock = 0
    const drafts = createDraftStore(database.db, { delay: 1_000, now: () => clock })
    drafts.putBlob(new TextEncoder().encode("old"))
    drafts.set("other", JSON.stringify({ n: 1 }))
    drafts.flush()
    clock = collectInterval + 1
    // The renderer uploads first and saves the referencing document up to a second later.
    const image = drafts.putBlob(new Uint8Array([1, 2, 3]))
    drafts.set("other", JSON.stringify({ n: 2 }))
    drafts.flush()
    expect(drafts.getBlob(image)).not.toBeNull()
    drafts.set("doc", JSON.stringify({ prompt: [{ type: "image", blob: { id: image } }] }))
    drafts.flush()
    expect(drafts.getBlob(image)).not.toBeNull()
  })
})

const collectInterval = 60_000
