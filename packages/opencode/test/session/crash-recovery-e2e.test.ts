import { expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ActiveManifest, setManifestDir } from "@/session/active-manifest"

async function withTmpDir(fn: (dir: string) => Promise<void>) {
  const dir = path.join(os.tmpdir(), "opencode-e2e-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test("E2E: crash leaves manifest, clean shutdown clears it", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)

    // 1. Simulate sessions going busy
    await Effect.runPromise(ActiveManifest.write({ id: "s1", timestamp: Date.now() }))
    await Effect.runPromise(ActiveManifest.write({ id: "s2", timestamp: Date.now() }))

    // 2. Crash: manifest should persist
    const afterCrash = await Effect.runPromise(ActiveManifest.read())
    expect(afterCrash).toHaveLength(2)
    const crashed = await Effect.runPromise(ActiveManifest.hasCrashed())
    expect(crashed).toBe(true)

    // 3. Simulate one session going idle
    await Effect.runPromise(ActiveManifest.remove("s1"))
    const afterIdle = await Effect.runPromise(ActiveManifest.read())
    expect(afterIdle).toHaveLength(1)
    expect(afterIdle[0].id).toBe("s2")

    // 4. Simulate last session going idle
    await Effect.runPromise(ActiveManifest.remove("s2"))
    const afterLastIdle = await Effect.runPromise(ActiveManifest.read())
    expect(afterLastIdle).toHaveLength(0)

    // 5. After all sessions idle, manifest file should be deleted
    const fileExists = await Effect.runPromise(ActiveManifest.hasCrashed())
    expect(fileExists).toBe(false)
  })
})

test("E2E: crash with multiple sessions, then clean shutdown clears all", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)

    // 1. Multiple sessions active
    await Effect.runPromise(ActiveManifest.write({ id: "s1", timestamp: Date.now() }))
    await Effect.runPromise(ActiveManifest.write({ id: "s2", timestamp: Date.now() }))
    await Effect.runPromise(ActiveManifest.write({ id: "s3", timestamp: Date.now() }))

    // 2. Crash — manifest persists with all sessions
    expect(await Effect.runPromise(ActiveManifest.hasCrashed())).toBe(true)
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(3)

    // 3. Clean shutdown — manifest cleared
    await Effect.runPromise(ActiveManifest.clear())
    expect(await Effect.runPromise(ActiveManifest.hasCrashed())).toBe(false)
    expect(await Effect.runPromise(ActiveManifest.read())).toHaveLength(0)
  })
})

test("E2E: manifest survives corrupt JSON (graceful degradation)", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)

    // Write corrupt JSON to manifest file
    const manifestPath = path.join(dir, "active-sessions.json")
    await fs.writeFile(manifestPath, "{ broken json")

    // Read should return empty array, not throw
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)

    // hasCrashed should still return true (file exists)
    expect(await Effect.runPromise(ActiveManifest.hasCrashed())).toBe(true)

    // After clear, file is gone
    await Effect.runPromise(ActiveManifest.clear())
    expect(await Effect.runPromise(ActiveManifest.hasCrashed())).toBe(false)
  })
})

test("E2E: write-update cycle preserves only latest entry per session", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)

    // Write session with timestamp T1
    await Effect.runPromise(ActiveManifest.write({ id: "s1", timestamp: 1000 }))

    // Update same session with timestamp T2
    await Effect.runPromise(ActiveManifest.write({ id: "s1", timestamp: 2000 }))

    // Should have only one entry with latest timestamp
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].timestamp).toBe(2000)

    // Write a second session
    await Effect.runPromise(ActiveManifest.write({ id: "s2", timestamp: 3000 }))
    const sessions2 = await Effect.runPromise(ActiveManifest.read())
    expect(sessions2).toHaveLength(2)
  })
})
