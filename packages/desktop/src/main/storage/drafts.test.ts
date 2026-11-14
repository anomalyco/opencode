import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import { sql } from "drizzle-orm"
import { openDatabase } from "./database"
import { BLOB_GRACE_MS, COLLECT_INTERVAL_MS } from "./draft-gc-machine"
import { createDraftStore } from "./drafts"

const start = Date.UTC(2026, 6, 1)

const clock = (ms: number) => setSystemTime(new Date(start + ms))

const text = (...ids: string[]) =>
  JSON.stringify({ prompt: [{ type: "text", content: { blob: { kind: "text", ids } } }] })

beforeEach(() => clock(0))

afterEach(() => setSystemTime())

describe("draft store", () => {
  test("queues documents and reads them back before and after flush", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    drafts.set("a:draft:prompt", "{}")
    expect(drafts.get("a:draft:prompt")).toBe("{}")
    drafts.flush()
    expect(drafts.get("a:draft:prompt")).toBe("{}")
    drafts.set("a:draft:prompt", null)
    expect(drafts.get("a:draft:prompt")).toBeNull()
    drafts.flush()
    expect(database.db.all(sql`SELECT key FROM document`)).toEqual([])
  })

  test("stores blobs by content hash and collects unreferenced ones shortly after open", async () => {
    const database = openDatabase(":memory:")
    const first = createDraftStore(database.db)
    const used = first.putBlob(new Uint8Array([1, 2, 3]))
    const unused = first.putBlob(new Uint8Array([4, 5, 6]))
    expect(first.putBlob(new Uint8Array([1, 2, 3]))).toBe(used)
    first.set("doc", JSON.stringify({ parts: [{ blob: { id: used } }] }))
    first.flush()
    first.close()
    // The startup collection runs off the window's critical path and keeps the usual grace, so a
    // blob from a session that ended within the grace period is still there...
    const second = createDraftStore(database.db, { collectDelay: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(second.getBlob(unused)).toEqual(new Uint8Array([4, 5, 6]))
    second.close()
    // ...and gone once the grace has passed.
    clock(BLOB_GRACE_MS + 1)
    const third = createDraftStore(database.db, { collectDelay: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(third.getBlob(used)).toEqual(new Uint8Array([1, 2, 3]))
    expect(third.getBlob(unused)).toBeNull()
    third.close()
  })

  test("collects a retired chunk only once it is unreferenced and past the grace period", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    const a = drafts.putBlob(new TextEncoder().encode("chunk a"))
    const b = drafts.putBlob(new TextEncoder().encode("chunk b"))
    drafts.set("doc", text(a, b))
    drafts.flush()
    const c = drafts.putBlob(new TextEncoder().encode("chunk c"))
    drafts.set("doc", text(a, c))
    drafts.flush()
    // Retired but recently touched: survives a due collection.
    clock(120_000)
    drafts.putBlob(new TextEncoder().encode("chunk d"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(b)).not.toBeNull()
    // Past the grace period and still unreferenced: collected. Referenced chunks stay.
    clock(120_000 + BLOB_GRACE_MS + 1)
    drafts.putBlob(new TextEncoder().encode("chunk e"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(a)).not.toBeNull()
    expect(drafts.getBlob(c)).not.toBeNull()
    expect(drafts.getBlob(b)).toBeNull()
  })

  test("a document that republishes a cached chunk id refreshes the chunk without an upload", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    const a = drafts.putBlob(new TextEncoder().encode("A"))
    drafts.set("doc", text(a))
    drafts.flush()
    // Edit away from A; A becomes unreferenced.
    const b = drafts.putBlob(new TextEncoder().encode("A!"))
    drafts.set("doc", text(b))
    drafts.flush()
    // Long after, undo republishes A from the renderer cache with no upload. The write touches A.
    clock(BLOB_GRACE_MS - 1)
    drafts.set("doc", text(a))
    drafts.flush()
    clock(BLOB_GRACE_MS + COLLECT_INTERVAL_MS)
    drafts.putBlob(new TextEncoder().encode("unrelated"))
    drafts.set("other", "{}")
    drafts.flush()
    expect(drafts.getBlob(a)).not.toBeNull()
    expect(drafts.getBlob(b)).toBeNull()
  })

  test("set reports referenced blobs the store does not hold so the renderer can upload them again", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    const kept = drafts.putBlob(new TextEncoder().encode("kept"))
    const image = drafts.putBlob(new Uint8Array([9]))

    const document = JSON.stringify({
      prompt: [
        { type: "text", content: { blob: { kind: "text", ids: [kept, "gone-chunk"] } } },
        { type: "image", blob: { id: image } },
        { type: "image", blob: { id: "gone-image" } },
      ],
    })

    // A strict write with missing blobs is refused: the previous document remains.
    drafts.set("doc", JSON.stringify({ previous: true }))
    expect(drafts.set("doc", document, true).sort()).toEqual(["gone-chunk", "gone-image"])
    expect(drafts.get("doc")).toBe(JSON.stringify({ previous: true }))
    // A non-strict write stores it anyway and still reports what is missing.
    expect(drafts.set("doc", document, false).sort()).toEqual(["gone-chunk", "gone-image"])
    expect(drafts.get("doc")).toBe(document)
    expect(drafts.set("plain", "not json", true)).toEqual([])
    expect(drafts.set("doc", null, true)).toEqual([])
    expect(drafts.set("doc", document, true)).not.toContain(kept)
  })

  test("an uploaded attachment survives a due collection before its document is written", () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    drafts.putBlob(new TextEncoder().encode("old"))
    drafts.set("other", JSON.stringify({ n: 1 }))
    drafts.flush()
    clock(COLLECT_INTERVAL_MS + 1)
    // The renderer uploads first and saves the referencing document up to a second later.
    const image = drafts.putBlob(new Uint8Array([1, 2, 3]))
    drafts.set("other", JSON.stringify({ n: 2 }))
    drafts.flush()
    expect(drafts.getBlob(image)).not.toBeNull()
    drafts.set("doc", JSON.stringify({ prompt: [{ type: "image", blob: { id: image } }] }))
    drafts.flush()
    expect(drafts.getBlob(image)).not.toBeNull()
  })

  const withImage = () => {
    const database = openDatabase(":memory:")
    const drafts = createDraftStore(database.db)
    const image = drafts.putBlob(new Uint8Array([1, 2, 3]))
    drafts.set("doc", JSON.stringify({ prompt: [{ type: "image", blob: { id: image } }] }))
    drafts.flush()

    return { drafts, image }
  }

  test("a draft deleted after a sweep that kept its image referenced has the image collected without an upload", () => {
    const app = withImage()
    clock(COLLECT_INTERVAL_MS + 1)
    app.drafts.set("other", "{}")
    app.drafts.flush()
    clock(COLLECT_INTERVAL_MS + 1 + BLOB_GRACE_MS + 1)
    app.drafts.set("doc", null)
    app.drafts.flush()

    expect(app.drafts.getBlob(app.image)).toBeNull()
    app.drafts.close()
  })

  test("an image a sweep kept inside the grace period is collected once the grace passes", () => {
    const app = withImage()
    clock(COLLECT_INTERVAL_MS + 1)
    app.drafts.set("doc", null)
    app.drafts.flush()
    expect(app.drafts.getBlob(app.image)).not.toBeNull()
    // Only plain-text drafts change afterwards.
    clock(BLOB_GRACE_MS + 1)
    app.drafts.set("other", "plain")
    app.drafts.flush()

    expect(app.drafts.getBlob(app.image)).toBeNull()
    app.drafts.close()
  })

  test("a failed sweep is reported once and does not fail the committed draft write", () => {
    const database = openDatabase(":memory:")
    const errors: unknown[] = []
    const drafts = createDraftStore(database.db, { onError: (error) => errors.push(error) })
    drafts.putBlob(new Uint8Array([1]))
    database.db.run(sql`CREATE TRIGGER refuse BEFORE DELETE ON blob BEGIN SELECT RAISE(ABORT, 'sweep refused'); END`)
    clock(BLOB_GRACE_MS + 1)
    drafts.set("doc", "{}")
    drafts.flush()
    drafts.flush()

    expect(errors).toHaveLength(1)
    expect(database.db.all(sql`SELECT key FROM document`)).toEqual([{ key: "doc" }])
    drafts.close()
  })
})
