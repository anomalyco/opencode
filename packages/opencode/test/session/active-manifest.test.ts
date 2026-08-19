import { expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ActiveManifest, setManifestDir } from "@/session/active-manifest"

const sampleEntry = {
  id: "session-001",
  model: { id: "claude-sonnet", providerID: "anthropic" },
  agent: "build",
  timestamp: Date.now(),
}

async function withTmpDir(fn: (dir: string) => Promise<void>) {
  const dir = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test("writeActiveSession creates manifest with session", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("session-001")
  })
})

test("writeActiveSession adds to existing manifest", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    await Effect.runPromise(
      ActiveManifest.write({
        id: "session-002",
        model: { id: "gpt-4", providerID: "openai" },
        agent: "general",
        timestamp: Date.now(),
      }),
    )
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(2)
  })
})

test("writeActiveSession updates existing session", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    await Effect.runPromise(ActiveManifest.write({ ...sampleEntry, agent: "plan" }))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].agent).toBe("plan")
  })
})

test("removeActiveSession removes from manifest", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    await Effect.runPromise(ActiveManifest.remove("session-001"))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)
  })
})

test("clearActiveSessions deletes the manifest file", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    await Effect.runPromise(ActiveManifest.clear())
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)
  })
})

test("hasCrashed returns false when no manifest exists", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    const crashed = await Effect.runPromise(ActiveManifest.hasCrashed())
    expect(crashed).toBe(false)
  })
})

test("hasCrashed returns true when manifest exists", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    const crashed = await Effect.runPromise(ActiveManifest.hasCrashed())
    expect(crashed).toBe(true)
  })
})

test("read returns empty array when manifest does not exist", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)
  })
})
