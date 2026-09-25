import { afterEach, expect, spyOn, test } from "bun:test"
import * as fs from "fs"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { createStorage } from "../../src/context/storage"

afterEach(() => {
  spyOn(fs, "watch").mockRestore()
})

test("createStorage degrades gracefully when fs.watch throws (e.g. ENOSPC)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-test-"))
  // fs.watch throws synchronously when inotify_add_watch fails (e.g. the watch
  // limit is exhausted). Simulate that scoped to this test only.
  spyOn(fs, "watch").mockImplementation(() => {
    throw Object.assign(new Error("ENOSPC: no space left on device, watch '/some/dir'"), { code: "ENOSPC" })
  })

  try {
    let result: ReturnType<typeof createStorage> | undefined
    expect(() => {
      result = createStorage(dir, "next")
    }).not.toThrow()

    // storage should still be usable even though the live-reload watcher failed to attach
    const [store, update] = result!.storage.store("kv", { initial: { count: 0 } })
    expect(store.count).toBe(0)
    await update((draft) => {
      draft.count = 1
    })
    expect(store.count).toBe(1)
    expect(() => result!.close()).not.toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("createStorage disables live-reload when an active watcher emits an error", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-test-"))
  const watcher = fs.watch(dir)
  const close = spyOn(watcher, "close")
  const log = spyOn(console, "error").mockImplementation(() => undefined)
  spyOn(fs, "watch").mockReturnValue(watcher)

  let result: ReturnType<typeof createStorage> | undefined
  try {
    result = createStorage(dir, "next")
    const [store, update] = result.storage.store("kv", { initial: { count: 0 } })

    expect(() => watcher.emit("error", new Error("watch failed"))).not.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)

    await update((draft) => {
      draft.count = 1
    })
    expect(store.count).toBe(1)
    result.close()
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    result?.close()
    watcher.close()
    log.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  }
})
