import { describe, expect, test } from "bun:test"

// node:sqlite solo existe en Node/Electron (el runtime de la app empaquetada).
// bun no lo implementa (usa bun:sqlite), así que bajo `bun test` estos tests se saltan.
const hasNodeSqlite = await import("node:sqlite")
  .then(() => true)
  .catch(() => false)

describe.skipIf(!hasNodeSqlite)("draft store", () => {
  test("flushes the latest buffered draft and stores blobs", async () => {
    const { createDesktopDraftStore } = await import("./draft-store")
    const store = createDesktopDraftStore(":memory:")
    store.set("prompt", "first")
    store.set("prompt", "latest")
    expect(store.get("prompt")).toBe("latest")
    store.flush()
    expect(store.get("prompt")).toBe("latest")

    const bytes = new TextEncoder().encode("image")
    const id = store.putBlob(bytes)
    expect(store.getBlob(id)).toEqual(bytes)
    store.close()
  })
})
