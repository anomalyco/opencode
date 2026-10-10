import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { safeWatch } from "../../src/util/watch"

test("safeWatch degrades gracefully when fs.watch throws", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "safe-watch-"))
  try {
    // fs.watch throws synchronously when the watch cannot be created: ENOENT for
    // this missing directory, EMFILE/ENOSPC in constrained containers.
    const missing = path.join(directory, "missing")
    expect(() => safeWatch(missing, () => {})).not.toThrow()
    expect(safeWatch(missing, () => {})).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("safeWatch honors the file watcher disable switch", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "safe-watch-"))
  const previous = process.env.OPENCODE_DISABLE_FILEWATCHER
  try {
    process.env.OPENCODE_DISABLE_FILEWATCHER = "true"
    expect(safeWatch(directory, () => {})).toBeUndefined()
    delete process.env.OPENCODE_DISABLE_FILEWATCHER
    const watcher = safeWatch(directory, () => {})
    expect(watcher).toBeDefined()
    watcher?.close()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_DISABLE_FILEWATCHER
    else process.env.OPENCODE_DISABLE_FILEWATCHER = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
