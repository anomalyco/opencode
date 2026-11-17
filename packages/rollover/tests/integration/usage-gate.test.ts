import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defaultSessionState, handleUsage, trackTouchedFile, type HookDeps } from "../../src/adapter/opencode/hooks"
import { createStore } from "../../src/adapter/opencode/store"

function setup(projectConfig?: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-gate-"))
  mkdirSync(path.join(dir, ".opencode", "rollover"), { recursive: true })
  if (projectConfig) {
    writeFileSync(path.join(dir, ".opencode", "rollover.json"), JSON.stringify(projectConfig))
  }
  const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
  const deps = {
    store,
    dataDir: path.join(dir, ".opencode", "rollover"),
    homeConfigDir: dir,
    projectDir: dir,
    env: {} as Record<string, string | undefined>,
    modelLimits: new Map<string, number>(),
    extractionInflight: new Map<string, Promise<void>>(),
    lastMessages: new Map(),
    scheduler: {},
    log: () => {},
  } as unknown as HookDeps
  return { dir, store, deps }
}

const usageEvent = (sid: string, input = 50, cacheRead = 26) => ({
  type: "session.step.ended",
  data: {
    sessionID: sid,
    tokens: { input, output: 10, reasoning: 0, cache: { read: cacheRead, write: 0 } },
  },
})

describe("usage tracking is gated on rollover being active", () => {
  test("off (default) → no state materialization, no tracking", async () => {
    const { dir, store, deps } = setup()
    try {
      await handleUsage(deps, usageEvent("s1"))
      expect(await store.readState("s1")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("enabled session → context counter updates", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: true } })
      await handleUsage(deps, usageEvent("s1"))
      const st = await store.readState("s1")
      expect(st?.lastContextTokens).toBe(76)
      expect(st?.lastContextSource).toBe("usage")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("explicitly off session → counter unchanged", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: false }, lastContextTokens: 5 })
      await handleUsage(deps, usageEvent("s1"))
      const st = await store.readState("s1")
      expect(st?.lastContextTokens).toBe(5)
      expect(st?.lastContextSource).toBe("estimate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("config mode auto → materializes and tracks", async () => {
    const { dir, store, deps } = setup({ mode: "auto" })
    try {
      await handleUsage(deps, usageEvent("s1"))
      const st = await store.readState("s1")
      expect(st?.lastContextTokens).toBe(76)
      expect(st?.lastContextSource).toBe("usage")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("touched-file tracking stops while off", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: false } })
      await trackTouchedFile(deps, { tool: "edit", sessionID: "s1", input: { path: "/x/a.ts" } })
      const st = await store.readState("s1")
      expect(Object.keys(st?.touchedFiles ?? {})).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("touched-file tracking runs while active", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: true } })
      await trackTouchedFile(deps, { tool: "edit", sessionID: "s1", input: { path: path.join(dir, "a.ts") } })
      const st = await store.readState("s1")
      expect(Object.keys(st?.touchedFiles ?? {})).toEqual(["a.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
