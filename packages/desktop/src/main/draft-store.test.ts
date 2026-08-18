import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDesktopDraftStore } from "./draft-store"

function tempFile() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-drafts-"))
  return { path: join(directory, "drafts.sqlite"), cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

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

test("keeps blobs a draft still references and drops the rest", () => {
  const store = createDesktopDraftStore(":memory:")
  const kept = store.putBlob(new TextEncoder().encode("kept"))
  const orphan = store.putBlob(new TextEncoder().encode("orphan"))
  store.set("prompt", JSON.stringify({ prompt: [{ type: "image", blob: { id: kept } }] }))

  // The draft is still buffered here, so the sweep has to flush before it can see the reference.
  store.collectBlobs()

  expect(store.getBlob(kept)).not.toBeNull()
  expect(store.getBlob(orphan)).toBeNull()
  store.close()
})

test("reopens without reading a huge draft back into the main process", () => {
  const file = tempFile()
  const huge = JSON.stringify({ prompt: [{ type: "text", content: "x".repeat(4 * 1024 * 1024) }] })
  try {
    const first = createDesktopDraftStore(file.path)
    const kept = first.putBlob(new TextEncoder().encode("attachment"))
    const orphan = first.putBlob(new TextEncoder().encode("orphan"))
    first.set("session-a", huge)
    first.set("session-b", JSON.stringify({ prompt: [{ type: "image", blob: { id: kept } }] }))
    first.close()

    const second = createDesktopDraftStore(file.path)

    // Startup used to JSON.parse every stored draft to find blob references, so a draft this
    // size blocked the main process before the first window could open. Timing it here would be
    // flaky, so this asserts the reason instead: opening collects nothing, which is the only way
    // it can avoid looking through the drafts, and the orphan survives until the sweep runs.
    expect(second.getBlob(orphan)).not.toBeNull()
    expect(second.get("session-a")).toBe(huge)
    expect(second.getBlob(kept)).not.toBeNull()

    second.collectBlobs()
    expect(second.getBlob(orphan)).toBeNull()
    expect(second.getBlob(kept)).not.toBeNull()

    // The draft is still editable and removable after the restart.
    second.set("session-a", JSON.stringify({ prompt: [{ type: "text", content: "small" }] }))
    second.flush()
    expect(second.get("session-a")).toContain("small")
    second.set("session-a", null)
    second.flush()
    expect(second.get("session-a")).toBeNull()
    second.close()

    const third = createDesktopDraftStore(file.path)
    expect(third.get("session-a")).toBeNull()
    third.close()
  } finally {
    file.cleanup()
  }
})

test("opens even when a stored draft is not valid JSON", () => {
  const file = tempFile()
  try {
    const first = createDesktopDraftStore(file.path)
    first.putBlob(new TextEncoder().encode("attachment"))
    first.set("broken", "{not json")
    first.close()

    // A row the main process cannot read must not turn into a startup crash loop, and the
    // sweep that runs afterwards must not either.
    const second = createDesktopDraftStore(file.path)
    second.collectBlobs()
    expect(second.get("broken")).toBe("{not json")
    second.close()
  } finally {
    file.cleanup()
  }
})
