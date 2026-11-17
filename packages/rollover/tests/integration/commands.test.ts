import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runCtl, type CtlDeps } from "../../src/adapter/opencode/ctl"
import { createStore } from "../../src/adapter/opencode/store"
import { defaultSessionState } from "../../src/adapter/opencode/hooks"

function setup(): { dir: string; store: ReturnType<typeof createStore>; deps: CtlDeps } {
  const dir = mkdtempSync(path.join(tmpdir(), "ctl-render-"))
  mkdirSync(path.join(dir, ".opencode"), { recursive: true })
  writeFileSync(
    path.join(dir, ".opencode", "rollover.json"),
    JSON.stringify({ mode: "auto", thresholdTokens: 200_000, renderBudgetTokens: 4000, extractionModel: "test/model" }),
  )
  const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
  const deps: CtlDeps = {
    store,
    homeConfigDir: dir,
    projectDir: dir,
    env: {} as Record<string, string | undefined>,
    modelLimits: new Map<string, number>([["s1", 1_000_000]]),
    lastMessages: new Map(),
  }
  return { dir, store, deps }
}

/** No rollover.json anywhere → the built-in default (mode off) applies. */
function setupOff(): { dir: string; store: ReturnType<typeof createStore>; deps: CtlDeps } {
  const dir = mkdtempSync(path.join(tmpdir(), "ctl-off-"))
  mkdirSync(path.join(dir, ".opencode", "rollover"), { recursive: true })
  const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
  const deps: CtlDeps = {
    store,
    homeConfigDir: dir,
    projectDir: dir,
    env: {} as Record<string, string | undefined>,
    modelLimits: new Map<string, number>([["s1", 1_000_000]]),
    lastMessages: new Map(),
  }
  return { dir, store, deps }
}

describe("/rollover --render", () => {
  test("stores the per-session budget and implies activation", async () => {
    const { dir, store, deps } = setup()
    try {
      await runCtl(deps, "s1", "--render 10k")
      expect((await store.readState("s1"))?.settings).toEqual({ renderBudgetTokens: 10_000, enabled: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("status shows the session budget over the config value", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", {
        v: 1,
        sessionId: "s1",
        settings: { enabled: true, renderBudgetTokens: 10_000 },
        epoch: 0,
        extractedUntilMessageId: null,
        lastContextTokens: 0,
        lastContextSource: "estimate",
        lastContextAt: 0,
        rollover: null,
        decidedUserMessageIds: [],
        consolidatedAtRecordCount: 0,
        touchedFiles: {},
      })
      const text = await runCtl(deps, "s1", "status")
      expect(text).toContain("/ 10k")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("below the minimum is rejected without touching settings", async () => {
    const { dir, store, deps } = setup()
    try {
      const text = await runCtl(deps, "s1", "--render 500")
      expect(text).toContain("Render budget must be at least 1k.")
      expect((await store.readState("s1"))?.settings).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("bare /rollover activates", () => {
  test("activates auto mode on a fresh session and reports it", async () => {
    const { dir, store, deps } = setupOff()
    try {
      const activated: string[] = []
      deps.onActivate = (sid) => activated.push(sid)
      const text = await runCtl(deps, "s1", "")
      expect((await store.readState("s1"))?.settings.enabled).toBe(true)
      expect(text).toContain("Rollover: on (auto)")
      expect(text).toContain("Rollover activated")
      expect(activated).toEqual(["s1"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("already active → says so, changes nothing, no catch-up", async () => {
    const { dir, store, deps } = setupOff()
    try {
      const before = { ...defaultSessionState("s1"), settings: { enabled: true, thresholdTokens: 123_456 } }
      await store.writeState("s1", before)
      const activated: string[] = []
      deps.onActivate = (sid) => activated.push(sid)
      const text = await runCtl(deps, "s1", "")
      expect(text).toContain("already active")
      expect((await store.readState("s1"))?.settings).toEqual(before.settings)
      expect(activated).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("/rollover on triggers the catch-up on transition, not when already on", async () => {
    const { dir, store, deps } = setupOff()
    try {
      const activated: string[] = []
      deps.onActivate = (sid) => activated.push(sid)
      await runCtl(deps, "s1", "on")
      expect((await store.readState("s1"))?.settings.enabled).toBe(true)
      expect(activated).toEqual(["s1"])
      await runCtl(deps, "s1", "on")
      expect(activated).toEqual(["s1"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("status on a fresh session materializes nothing", async () => {
    const { dir, store, deps } = setupOff()
    try {
      await runCtl(deps, "s1", "status")
      expect(await store.readState("s1")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("show on a fresh session materializes nothing", async () => {
    const { dir, store, deps } = setupOff()
    try {
      const text = await runCtl(deps, "s1", "show")
      expect(text).toContain("No records yet.")
      expect(await store.readState("s1")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("status card vs mode", () => {
  test("off → no active render is shown", async () => {
    const { dir, store, deps } = setupOff()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: false } })
      const text = await runCtl(deps, "s1", "status")
      expect(text).toContain("Rollover: off")
      expect(text).not.toContain("active render ≈")
      expect(text).toContain("active render —")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("auto → active render is shown", async () => {
    const { dir, store, deps } = setup()
    try {
      await store.writeState("s1", { ...defaultSessionState("s1"), settings: { enabled: true } })
      const text = await runCtl(deps, "s1", "status")
      expect(text).toContain("active render ≈")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
