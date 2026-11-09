import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createStorage } from "../../src/context/storage"
import { sanitizeSegment } from "../../src/plugin/api"

// The host composes `plugin.${id}.${key}` verbatim, so a plugin id holding
// characters outside the storage segment charset (scoped npm ids contain `@`
// and `/`) throws on any storage access. sanitizeSegment maps ids into the
// charset: identity for ids that are already valid segments (existing stored
// data keeps its file), escaping for the rest.

test("sanitizeSegment keeps valid ids unchanged", () => {
  expect(sanitizeSegment("plain-name")).toBe("plain-name")
  expect(sanitizeSegment("acme_tools")).toBe("acme_tools")
  // segment() validates the composed key, which starts with "plugin.", so
  // dot-only ids never reach the traversal rejection.
  expect(sanitizeSegment(".")).toBe(".")
  expect(sanitizeSegment("..")).toBe("..")
})

test("sanitizeSegment gives distinct ids distinct segments", () => {
  expect(sanitizeSegment("@acme/tools")).not.toBe(sanitizeSegment("acme_tools"))
  expect(sanitizeSegment("@a")).not.toBe(sanitizeSegment("a"))
  expect(sanitizeSegment("café")).not.toBe(sanitizeSegment("cafe"))
})

test("distinct ids write distinct storage files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-plugin-key-"))
  try {
    const { storage } = createStorage(dir, "next")
    const [first] = storage.store(`plugin.${sanitizeSegment("@acme/tools")}.state`, { initial: { n: 1 } })
    const [second] = storage.store(`plugin.${sanitizeSegment("acme_tools")}.state`, { initial: { n: 2 } })
    expect(first.n).toBe(1)
    expect(second.n).toBe(2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
