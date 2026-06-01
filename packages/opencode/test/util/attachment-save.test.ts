import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { saveDataUrlToFile } from "../../src/util/attachment-save"

function run<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(effect)
}

function pngDataUrl(): string {
  // Minimal 1x1 red PNG as base64
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
  return `data:image/png;base64,${png}`
}

describe("saveDataUrlToFile", () => {
  const sessionID = "test-session-123"
  const testDir = path.join(os.tmpdir(), "opencode-attachment-test-" + process.pid)

  test("save enabled — writes file and returns path", async () => {
    const cfg = { save_to_disk_path: testDir }
    const result = await run(saveDataUrlToFile(pngDataUrl(), cfg, sessionID))
    expect(result).toBeString()
    expect(result).toStartWith(path.join(testDir, sessionID))
    // Verify file exists
    const stat = await fs.stat(result!).catch(() => null)
    expect(stat).not.toBeNull()
    expect(stat!.isFile()).toBeTrue()
  })

  test("save disabled — returns undefined", async () => {
    const result = await run(saveDataUrlToFile(pngDataUrl(), { save_to_disk: false }, sessionID))
    expect(result).toBeUndefined()
  })

  test("custom path respected", async () => {
    const customDir = path.join(testDir, "custom")
    const result = await run(saveDataUrlToFile(pngDataUrl(), { save_to_disk_path: customDir }, sessionID))
    expect(result).toBeString()
    expect(result).toStartWith(path.join(customDir, sessionID))
  })

  test("default path when no config given", async () => {
    const result = await run(saveDataUrlToFile(pngDataUrl(), {}, sessionID))
    expect(result).toBeString()
    // Default: os.tmpdir()/opencode/attachments/{sessionID}/{ts}-{filename}
    expect(result).toStartWith(path.join(os.tmpdir(), "opencode", "attachments", sessionID))
    // Cleanup
    if (result) {
      await fs.rm(path.dirname(result), { recursive: true, force: true })
    }
  })

  test("write error — returns undefined gracefully", async () => {
    // Use a path that will fail (root-owned dir without write permission)
    const badPath = "/root/opencode-test"
    const result = await run(saveDataUrlToFile(pngDataUrl(), { save_to_disk_path: badPath }, sessionID))
    expect(result).toBeUndefined()
  })

  test("existing file conflict — timestamp prefix guarantees uniqueness", async () => {
    const cfg = { save_to_disk_path: testDir }
    const result1 = await run(saveDataUrlToFile(pngDataUrl(), cfg, sessionID))
    const result2 = await run(saveDataUrlToFile(pngDataUrl(), cfg, sessionID))
    expect(result1).toBeString()
    expect(result2).toBeString()
    expect(result1).not.toBe(result2) // different timestamps
  })
})
