import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createStorage } from "../../src/context/storage"
import { sanitizeSegment } from "../../src/plugin/api"

// Plugin ids come from npm package names: scoped ids contain `@` and `/`, which
// the storage layer rejects as invalid path segments (TypeError at runtime).
// The storage key is composed host-side (`plugin.${id}.${key}`), so the plugin
// itself cannot work around this by sanitizing its own key.

test("sanitizeSegment converts scoped npm plugin ids to valid storage segments", () => {
  expect(sanitizeSegment("@log0u7/opencode-mesh.tui")).toBe("log0u7_opencode-mesh.tui")
  expect(sanitizeSegment("plain-name")).toBe("plain-name")
  expect(sanitizeSegment("..")).toBe("__")
})

test("storage accepts a sanitized plugin-scoped key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-plugin-key-"))
  try {
    const { storage } = createStorage(dir, "next")
    const raw = `plugin.@log0u7/opencode-mesh.tui.mesh-sidebar`
    // The raw composed key is what crashes plugin TUIs today.
    expect(() => storage.store(raw, { initial: { collapsed: false } })).toThrow(TypeError)
    const safe = `plugin.${sanitizeSegment("@log0u7/opencode-mesh.tui")}.mesh-sidebar`
    const [store] = storage.store(safe, { initial: { collapsed: false } })
    expect(store.collapsed).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
