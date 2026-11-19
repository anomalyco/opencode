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

describe("status/show after a swap report the frozen render (not a re-render)", () => {
  const frozen = (renderText: string) => ({
    epochAtSwap: 3,
    cutoffMessageId: "u2",
    tailMessageIds: [],
    renderText,
    lastReply: "",
    appliedAt: 1,
    tokensBefore: 100,
    tokensAfter: 20,
  })

  test("status reports the frozen render's tokens", async () => {
    const { dir, store, deps } = setup()
    try {
      const renderText =
        "<rollover_context epoch='3'>\n\n## User prompts\n- [u1] frozen prompt FROZENMARKER\n</rollover_context>"
      await store.writeState("s1", {
        ...defaultSessionState("s1"),
        epoch: 3,
        settings: { enabled: true },
        rollover: frozen(renderText),
      })
      const text = await runCtl(deps, "s1", "status")
      expect(text).toContain("active render ≈")
      // the frozen block's estimate, not a stale pack of the ledger
      expect(text).toContain("active render ≈ 25 / 4k")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("show prints the frozen text verbatim", async () => {
    const { dir, store, deps } = setup()
    try {
      const renderText =
        "<rollover_context epoch='3'>\n\n## User prompts\n- [u1] frozen prompt FROZENMARKER\n</rollover_context>"
      await store.writeState("s1", {
        ...defaultSessionState("s1"),
        epoch: 3,
        settings: { enabled: true },
        rollover: frozen(renderText),
      })
      const text = await runCtl(deps, "s1", "show raw")
      expect(text).toContain("FROZENMARKER")
      expect(text).toContain("## User prompts")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("runImmediateSwap (the /rollover immediate path)", () => {
  const dir = () => {
    const d = mkdtempSync(path.join(tmpdir(), "ctl-imm-"))
    mkdirSync(path.join(d, ".opencode"), { recursive: true })
    writeFileSync(path.join(d, ".opencode", "rollover.json"), JSON.stringify({ thresholdTokens: 100, ledger: false }))
    return d
  }

  test("completes the swap when the threshold is already exceeded and the prompt was already decided", async () => {
    const d = dir()
    try {
      const store = createStore({ dataDir: path.join(d, ".opencode", "rollover") })
      await store.writeState("s1", {
        ...defaultSessionState("s1"),
        settings: { enabled: true },
        lastContextTokens: 5000,
        lastContextSource: "usage",
        decidedUserMessageIds: ["u2"],
      })
      const deps: CtlDeps & { scheduler?: unknown } = {
        store,
        homeConfigDir: d,
        projectDir: d,
        env: {},
        modelLimits: new Map([["s1", 1_000_000]]),
        lastMessages: new Map(),
      } as CtlDeps
      // minimal scheduler stub: the immediate path fires enrichment best-effort
      ;(deps as unknown as { scheduler: unknown }).scheduler = { runNow: async () => {} }
      const messages = [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "big first prompt " + "x".repeat(2000) }],
          createdAt: 0,
        },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "reply" }], createdAt: 0 },
        { id: "u2", role: "user", parts: [{ type: "text", text: "second prompt" }], createdAt: 0 },
      ]
      ;(deps as unknown as { lastMessages: Map<string, unknown> }).lastMessages.set("s1", messages)
      const notes: string[] = []
      const { runImmediateSwap } = await import("../../src/adapter/opencode/hooks")
      const suffix = await runImmediateSwap(deps as never, "s1", async (t: string) => {
        notes.push(t)
        await new Promise((r) => setTimeout(r, 30))
      })
      expect(suffix).toContain("Threshold exceeded")
      // let the fire-and-forget pipeline settle
      await new Promise((r) => setTimeout(r, 60))
      const st = await store.readState("s1")
      expect(st?.epoch).toBe(1)
      expect(st?.rollover?.cutoffMessageId).toBe("u2")
      expect(notes.join(" ")).toContain("Rollover applied")
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
