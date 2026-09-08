import { expect, test } from "bun:test"
import { openDatabase } from "../storage/database"
import { createExtensionManager, readExtensionAsset } from "./manager"
import { readArchive } from "./archive"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { extensionArchive } from "../../../test/extensions/fixture"
import { extensionAssetResponse } from "./assets"

test("installation, replacement, enable state and same-build reload persist in SQLite", async () => {
  const database = openDatabase(":memory:")
  const changed: string[] = []
  const manager = createExtensionManager({ db: database.db, fetch, changed: (id) => changed.push(id) })
  const archive = await extensionArchive({ files: { "assets/value.txt": "one" } })
  const [first] = await manager.install(archive)
  expect(first).toMatchObject({ id: "test.lifecycle", name: "File utilities", enabled: true, generation: 1 })
  expect(readExtensionAsset(database.db, first.id, first.revision, "assets/value.txt")?.toString()).toBe("one")
  const [reloaded] = manager.reload(first.id)
  expect(reloaded).toMatchObject({ revision: first.revision, generation: 2 })
  manager.enable(first.id, false)
  expect(() => manager.source(first.id, first.revision)).toThrow("disabled")
  const restored = createExtensionManager({ db: database.db, fetch, changed() {} })
  expect(restored.list()[0].enabled).toBe(false)
  expect(readExtensionAsset(database.db, first.id, first.revision, "assets/value.txt")).toBeUndefined()
  manager.enable(first.id, true)
  const [updated] = await manager.install(
    await extensionArchive({ version: "2.0.0", files: { "assets/value.txt": "two" } }),
  )
  expect(updated).toMatchObject({ version: "2.0.0", generation: 5 })
  expect(updated.revision).not.toBe(first.revision)
  expect(readExtensionAsset(database.db, first.id, updated.revision, "assets/value.txt")?.toString()).toBe("two")
  expect(readExtensionAsset(database.db, first.id, first.revision, "assets/value.txt")).toBeUndefined()
  expect(changed).toEqual(Array(5).fill(first.id))
  database.close()
})

test("a rejected update preserves the working archive", async () => {
  const database = openDatabase(":memory:")
  const manager = createExtensionManager({ db: database.db, fetch, changed() {} })
  const [first] = await manager.install(await extensionArchive())
  await expect(manager.install(await extensionArchive({ renderer: "export const broken =" }))).rejects.toThrow(
    "invalidModule",
  )
  await expect(manager.install(await extensionArchive({ id: "opencode.browser" }))).rejects.toThrow("reserved")
  expect(manager.list()).toEqual([first])
  expect(manager.source(first.id, first.revision).source).toContain("setup()")
  database.close()
})

test("archive assets retain byte ranges, HEAD and disabled-state behavior", async () => {
  const database = openDatabase(":memory:")
  const manager = createExtensionManager({ db: database.db, fetch, changed() {} })
  const [entry] = await manager.install(await extensionArchive({ files: { "assets/movie.webm": "0123456789" } }))
  const input = { id: entry.id, revision: entry.revision, path: "assets/movie.webm" }
  const range = extensionAssetResponse(database.db, { ...input, range: "bytes=2-5" })
  expect(range.status).toBe(206)
  expect(range.headers.get("Content-Range")).toBe("bytes 2-5/10")
  expect(await range.text()).toBe("2345")
  expect(await extensionAssetResponse(database.db, { ...input, range: "bytes=-3" }).text()).toBe("789")
  expect(extensionAssetResponse(database.db, { ...input, range: "bytes=20-" }).status).toBe(416)
  const head = extensionAssetResponse(database.db, { ...input, head: true })
  expect(head.headers.get("Content-Length")).toBe("10")
  expect(await head.text()).toBe("")
  manager.enable(entry.id, false)
  expect(extensionAssetResponse(database.db, input).status).toBe(404)
  database.close()
})

test.each([
  { manifest: { schema: 1 } },
  { manifest: { entry: "missing.cjs" } },
  { manifest: { main: "missing.cjs" } },
  { manifest: { entry: "../renderer.cjs" } },
  { files: { "../escape.txt": "bad" } },
  { files: { "C:/escape.txt": "bad" } },
])("validates the archive boundary: %j", async (input) => {
  await expect(readArchive(await extensionArchive(input))).rejects.toBeInstanceOf(ExtensionManager.ManagerError)
})

test("downloads archives over HTTP and rejects unsupported URLs or failed responses", async () => {
  const archive = await extensionArchive()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/extension.ocdx" ? new Response(archive) : new Response(null, { status: 404 }),
  })
  const database = openDatabase(":memory:")
  const manager = createExtensionManager({ db: database.db, fetch, changed() {} })
  try {
    expect(await manager.installURL(new URL("extension.ocdx", server.url).href)).toHaveLength(1)
    await expect(manager.installURL(new URL("missing.ocdx", server.url).href)).rejects.toThrow("download")
    await expect(manager.installURL("file:///extension.ocdx")).rejects.toThrow("url")
  } finally {
    server.stop(true)
    database.close()
  }
})
