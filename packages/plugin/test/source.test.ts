import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createPluginSources } from "../src/source.js"

// Keep this in the plugin package: the TUI suite installs a Solid import transform.
test("independent source caches recover after an overlapping failed import", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "opencode-source-")))
  const sources = createPluginSources(async () => {})
  const url = pathToFileURL(root + path.sep)
  const entry = new URL("tui.ts", url)
  const control = new URL("node_modules/control/index.mjs", url)
  await Bun.write(
    control,
    "export const started = Promise.withResolvers(); export const release = Promise.withResolvers()",
  )
  const gate = await import(control.href)
  const watched = Promise.withResolvers<void>()
  const other = createPluginSources(async () => watched.resolve())
  await Bun.write(
    entry,
    'import { started, release } from "./node_modules/control/index.mjs"; started.resolve(); await release.promise; throw new Error("old load failed")',
  )
  const first = sources.read(entry.href).catch((error: Error) => error.message)
  try {
    await gate.started.promise
    await Bun.write(entry, 'export default "recovered"')
    const second = other.read(entry.href)
    // Let the second loader enter while the first module is still evaluating.
    await watched.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    gate.release.resolve()
    expect(await first).toBe("old load failed")
    expect((await second).module).toMatchObject({ default: "recovered" })
    expect((await other.read(entry.href)).module).toMatchObject({ default: "recovered" })
  } finally {
    gate.release.resolve()
    await first
    other.dispose()
    sources.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

