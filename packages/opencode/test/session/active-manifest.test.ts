import { expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ActiveManifest, setManifestDir } from "@/session/active-manifest"

const sampleEntry = {
  id: "session-001",
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
    await Effect.runPromise(ActiveManifest.write({ ...sampleEntry, timestamp: 999 }))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].timestamp).toBe(999)
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

test("removeActiveSession deletes manifest file when last session removed", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    await Effect.runPromise(ActiveManifest.remove("session-001"))
    const crashed = await Effect.runPromise(ActiveManifest.hasCrashed())
    expect(crashed).toBe(false)
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

test("read returns empty array for valid-but-wrong-shape JSON", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    const manifestPath = path.join(dir, "active-sessions.json")
    await fs.writeFile(manifestPath, JSON.stringify({}))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)
  })
})

test("read returns empty array for valid array JSON", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    const manifestPath = path.join(dir, "active-sessions.json")
    await fs.writeFile(manifestPath, JSON.stringify([]))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(0)
  })
})

test("write after corrupt-shape manifest recovers gracefully", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    const manifestPath = path.join(dir, "active-sessions.json")
    await fs.writeFile(manifestPath, JSON.stringify({ sessions: "not-an-array" }))
    await Effect.runPromise(ActiveManifest.write(sampleEntry))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("session-001")
  })
})

test("multi-session manifest preserves write order", async () => {
  await withTmpDir(async (dir) => {
    setManifestDir(dir)
    await Effect.runPromise(ActiveManifest.write({ id: "s1", timestamp: 1000 }))
    await Effect.runPromise(ActiveManifest.write({ id: "s2", timestamp: 2000 }))
    const sessions = await Effect.runPromise(ActiveManifest.read())
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe("s1")
    expect(sessions[sessions.length - 1].id).toBe("s2")
  })
})
