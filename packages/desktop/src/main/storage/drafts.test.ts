import { expect, test } from "bun:test"
import { createDesktopDraftStore } from "./drafts"

test("flushes the latest buffered draft and stores blobs", () => {
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

test("allows repeated flushes until closing", () => {
  const store = createDesktopDraftStore(":memory:")
  store.set("prompt", "first")
  store.flush()
  store.set("prompt", "draft")
  store.flush()
  expect(store.get("prompt")).toBe("draft")
  store.close()

  expect(() => store.flush()).not.toThrow()
  expect(() => store.close()).not.toThrow()
})
