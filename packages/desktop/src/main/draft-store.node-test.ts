// Runs under Node (`bun run test:node`), not `bun test`: the store uses node:sqlite, which the
// desktop main process gets from Electron's Node runtime but Bun does not provide.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDesktopDraftStore } from "./draft-store.ts"

test("flushes the latest buffered draft and stores blobs", () => {
  const store = createDesktopDraftStore(":memory:")
  store.set("prompt", "first")
  store.set("prompt", "latest")
  assert.equal(store.get("prompt"), "latest")
  store.flush()
  assert.equal(store.get("prompt"), "latest")

  const bytes = new TextEncoder().encode("image")
  const id = store.putBlob(bytes)
  assert.deepEqual(new Uint8Array(store.getBlob(id)!), bytes)
  store.close()
})
