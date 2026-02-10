import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDiskHistory, historyPath } from "./history-disk"

const root = path.join(os.tmpdir(), `claxedo-pty-history-${Date.now()}-${Math.random().toString(36).slice(2)}`)

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
})

describe("pty disk history", () => {
  test("persists replay tail to disk and restores it", async () => {
    process.env.OPENCODE_PTY_HISTORY_DIR = root
    const a = await createDiskHistory({ directory: "/ws", id: "pty-a", limit: 16 })
    a.append("hello")
    a.append(" world")
    await a.close()

    const b = await createDiskHistory({ directory: "/ws", id: "pty-a", limit: 16 })
    expect(b.snapshot()).toBe("hello world")
    await b.clear()
  })

  test("compacts file to limit when oversized", async () => {
    process.env.OPENCODE_PTY_HISTORY_DIR = root
    const history = await createDiskHistory({ directory: "/ws", id: "pty-b", limit: 8 })
    history.append("1234")
    history.append("5678")
    history.append("90")
    await history.close()
    expect(history.snapshot()).toBe("34567890")
    const file = historyPath("/ws", "pty-b", root)
    const text = await fs.readFile(file, "utf8")
    expect(text).toBe("34567890")
    await history.clear()
  })

  test("clear removes history file from disk", async () => {
    process.env.OPENCODE_PTY_HISTORY_DIR = root
    const id = "pty-c"
    const dir = "/ws"
    const history = await createDiskHistory({ directory: dir, id, limit: 16 })
    history.append("data")
    await history.close()
    const file = historyPath(dir, id, root)
    await Bun.file(file).text()
    await history.clear()
    const exists = await Bun.file(file).exists()
    expect(exists).toBe(false)
  })

  test("server_history_file_compaction_under_concurrent_append", async () => {
    process.env.OPENCODE_PTY_HISTORY_DIR = root
    const history = await createDiskHistory({ directory: "/ws", id: "pty-concurrent", limit: 64 })

    await Promise.all(
      Array.from({ length: 40 }, (_, i) => Promise.resolve(history.append(`${String(i).padStart(2, "0")}|`))),
    )
    await history.close()

    const snapshot = history.snapshot()
    expect(snapshot.length).toBe(64)
    const file = historyPath("/ws", "pty-concurrent", root)
    const text = await fs.readFile(file, "utf8")
    expect(text.length).toBe(64)
    expect(text).toBe(snapshot)
    await history.clear()
  })

  test("server_history_clear_during_pending_flush_is_safe", async () => {
    process.env.OPENCODE_PTY_HISTORY_DIR = root
    const id = "pty-clear-pending"
    const dir = "/ws"
    const history = await createDiskHistory({ directory: dir, id, limit: 128 })

    history.append("abcdef")
    history.append("ghijkl")
    await history.clear()
    await history.close()

    expect(history.snapshot()).toBe("")
    const file = historyPath(dir, id, root)
    const exists = await Bun.file(file).exists()
    expect(exists).toBe(false)
  })
})
