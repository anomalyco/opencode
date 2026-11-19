import { describe, expect, test } from "bun:test"
import { runTransform } from "../../src/adapter/opencode/hooks"
import { createStore } from "../../src/adapter/opencode/store"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { NMessage } from "../../src/core/types"
import type { SessionState, RolloverConfig } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"
import { createScheduler } from "../../src/adapter/opencode/scheduler"

const cfg: RolloverConfig = { ...DEFAULT_CONFIG, mode: "auto", thresholdTokens: 1000, renderBudgetTokens: 4000, tailN: 0 }

function msg(id: string, role: "user" | "assistant", text: string): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0 }
}

function state(sid: string, over: Partial<SessionState> = {}): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: "a1",
    lastContextTokens: 2000, lastContextSource: "usage", lastContextAt: 0, rollover: null,
    decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {}, ...over,
  }
}

function makeDeps(dir: string, sid: string) {
  const store = createStore({ dataDir: dir })
  const lastMessages = new Map<string, NMessage[]>()
  const modelLimits = new Map<string, number>([[sid, 100000]])
  const deps = {
    store: store as any,
    dataDir: dir,
    homeConfigDir: dir,
    projectDir: dir,
    env: {} as Record<string, string | undefined>,
    modelLimits,
    extractionInflight: new Map(),
    lastMessages,
    scheduler: null as any,
    log: () => {},
  }
  const sched = createScheduler({
    store: store as any,
    getConfig: async () => cfg,
    getMessages: (s: string) => lastMessages.get(s),
    getState: async (s: string) => store.readState(s),
    setState: async (s, v) => store.writeState(s, v),
    getSmallModel: () => null,
    getSessionModel: async () => null,
    createLlm: () => ({ async complete() { return { text: '{"records":[]}', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: "m", latencyMs: 1 } } }),
    metric: async () => {},
    debounceMs: 5,
  })
  deps.scheduler = sched
  // override getConfig via... runTransform calls getConfig(deps, sid) which uses loadConfig. 
  // For tests, monkeypatch: store a cfg-returning function. We'll instead set env + files? Simpler: 
  // runTransform imports getConfig from hooks which calls loadConfig. To force cfg, write a rollover.json.
  return { deps, store, sched }
}

async function writeCfg(dir: string) {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(path.join(dir, ".opencode"), { recursive: true })
  writeFileSync(path.join(dir, ".opencode", "rollover.json"), JSON.stringify(cfg))
  // home config dir = dir (set homeConfigDir: dir); write there too
  writeFileSync(path.join(dir, "rollover.json"), JSON.stringify(cfg))
}

describe("runTransform", () => {
  test("T1 basic rollover: threshold exceeded → swap on next real user message", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const store = createStore({ dataDir: dir })
    const st = state(sid, { lastContextTokens: 2000 })
    await store.writeState(sid, st)
    const { deps } = makeDeps(dir, sid)
    // messages: prior assistant + new user (threshold already exceeded via state)
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "new question")] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    // raw should now be projected: render text + cutoff onward
    const joined = JSON.stringify(raw)
    expect(joined).toContain("rollover_context")
    expect(joined).toContain("new question")
    // state persisted with epoch 1
    const st2 = await store.readState(sid)
    expect(st2?.epoch).toBe(1)
    expect(st2?.rollover).not.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("T2 below threshold → no swap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const store = createStore({ dataDir: dir })
    const st = state(sid, { lastContextTokens: 100, extractedUntilMessageId: "a1" })
    await store.writeState(sid, st)
    const { deps } = makeDeps(dir, sid)
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const joined = JSON.stringify(raw)
    expect(joined).not.toContain("rollover_context")
    const st2 = await store.readState(sid)
    expect(st2?.epoch).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("T3 open tool → defer, then swap after completion", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const store = createStore({ dataDir: dir })
    const st = state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" })
    await store.writeState(sid, st)
    const { deps } = makeDeps(dir, sid)
    // inject pending tool into the assistant message
    const aWithPending = { id: "a1", role: "assistant", content: [{ type: "text", text: "earlier" }, { type: "tool-call", name: "bash", id: "c1", input: {} }], createdAt: 0 }
    const rawPending = [aWithPending, { id: "u2", role: "user", content: [{ type: "text", text: "q" }], createdAt: 0 }] as any[]
    await runTransform(deps, { messages: rawPending, sessionID: sid })
    const st2 = await store.readState(sid)
    expect(st2?.epoch).toBe(0) // deferred
    // now complete the tool
    const rawDone = [{ id: "a1", role: "assistant", content: [{ type: "text", text: "earlier" }, { type: "tool", tool: "bash", status: "completed" }], createdAt: 0 }, { id: "u2", role: "user", content: [{ type: "text", text: "q" }], createdAt: 0 }] as any[]
    await runTransform(deps, { messages: rawDone, sessionID: sid })
    const st3 = await store.readState(sid)
    expect(st3?.epoch).toBe(1) // swapped
    rmSync(dir, { recursive: true, force: true })
  })

  test("T5 restart replay: no duplicate swap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const store = createStore({ dataDir: dir })
    const st = state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" })
    await store.writeState(sid, st)
    const { deps } = makeDeps(dir, sid)
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const epoch1 = (await store.readState(sid))!.epoch
    // second call with same messages (replay) → no new swap
    const raw2 = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    await runTransform(deps, { messages: raw2, sessionID: sid })
    const epoch2 = (await store.readState(sid))!.epoch
    expect(epoch2).toBe(epoch1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("fresh session bootstraps a default state before deciding", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "fresh"
    const { deps, store } = makeDeps(dir, sid)
    // Long enough to be above the 1000-token override. v2: the swap is
    // deterministic and never waits for extraction, so the freshly created
    // state already carries the swap.
    const raw = [
      { id: "a1", role: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] },
      { id: "u2", role: "user", content: [{ type: "text", text: "q" }] },
    ] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const st = await store.readState(sid)
    expect(st).toEqual({
      v: 1,
      sessionId: sid,
      settings: {},
      epoch: 1,
      extractedUntilMessageId: null,
      lastContextTokens: expect.any(Number),
      lastContextSource: "estimate",
      lastContextAt: expect.any(Number),
      rollover: expect.objectContaining({ cutoffMessageId: "u2", epochAtSwap: 0 }),
      decidedUserMessageIds: ["u2"],
      consolidatedAtRecordCount: 0,
      touchedFiles: {},
      lastRollover: expect.any(Object),
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("T9 two sessions interleaved on one store stay isolated", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const { deps, store } = makeDeps(dir, "s1")
    deps.modelLimits.set("s2", 100000)
    await store.writeState("s1", state("s1", { lastContextTokens: 2000, extractedUntilMessageId: "a1" }))
    await store.writeState("s2", state("s2", { lastContextTokens: 2000, extractedUntilMessageId: "a2" }))

    const raw1 = [msg("a1", "assistant", "one"), msg("u1", "user", "first")] as any[]
    const raw2 = [msg("a2", "assistant", "two"), msg("u2", "user", "second")] as any[]
    await runTransform(deps, { messages: raw1, sessionID: "s1" })
    await runTransform(deps, { messages: raw2, sessionID: "s2" })

    const st1 = (await store.readState("s1"))!
    const st2 = (await store.readState("s2"))!
    expect(st1.epoch).toBe(1)
    expect(st2.epoch).toBe(1)
    expect(st1.rollover?.cutoffMessageId).toBe("u1")
    expect(st2.rollover?.cutoffMessageId).toBe("u2")
    expect(st1.decidedUserMessageIds).toEqual(["u1"])
    expect(st2.decidedUserMessageIds).toEqual(["u2"])
    expect(JSON.stringify(st1.rollover)).not.toContain("second")
    expect(JSON.stringify(st2.rollover)).not.toContain("first")
    rmSync(dir, { recursive: true, force: true })
  })

  test("T1-ordering: state is persisted before the projection is applied", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const store = createStore({ dataDir: dir })
    await store.writeState(sid, state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" }))
    const { deps } = makeDeps(dir, sid)

    const trace: string[] = []
    deps.store = {
      ...store,
      writeState: async (sessionID: string, value: SessionState) => {
        trace.push("writeState")
        await store.writeState(sessionID, value)
      },
    } as any

    const target = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    const raw = new Proxy(target, {
      get(t, prop) {
        if (prop === "splice") {
          return (...args: unknown[]) => {
            trace.push("splice")
            return Array.prototype.splice.apply(t, args as [number, number, ...unknown[]])
          }
        }
        return (t as unknown as Record<PropertyKey, unknown>)[prop]
      },
    })
    await runTransform(deps, { messages: raw, sessionID: sid })
    expect(trace.filter((entry) => entry === "writeState" || entry === "splice")).toEqual(["writeState", "splice"])
    rmSync(dir, { recursive: true, force: true })
  })

  test("swap keeps lastContextSource=usage and reports it in the metric", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, { lastContextTokens: 2000, lastContextSource: "usage", extractedUntilMessageId: "a1" }))
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const st = (await store.readState(sid))!
    expect(st.lastContextSource).toBe("usage")
    const metrics = readFileSync(path.join(dir, sid, "metrics.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ev: string; contextSource?: string })
    expect(metrics.find((m) => m.ev === "swap")?.contextSource).toBe("usage")
    rmSync(dir, { recursive: true, force: true })
  })

  test("swap uses estimate when no usage value existed and reports it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, { lastContextTokens: 0, lastContextSource: "estimate", extractedUntilMessageId: "a1" }))
    const raw = [
      { id: "a1", role: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] },
      { id: "u2", role: "user", content: [{ type: "text", text: "q" }] },
    ] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const st = (await store.readState(sid))!
    expect(st.lastContextSource).toBe("estimate")
    const metrics = readFileSync(path.join(dir, sid, "metrics.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ev: string; contextSource?: string })
    expect(metrics.find((m) => m.ev === "swap")?.contextSource).toBe("estimate")
    rmSync(dir, { recursive: true, force: true })
  })

  test("T10 failure-open: store throws → messages untouched", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    // store that throws on readState
    const brokenStore = {
      readState: async () => { throw new Error("disk failure") },
      writeState: async () => {},
      appendLedger: async () => {},
      readLedger: async () => [],
      appendMetric: async () => {},
      withSessionLock: async (_s: string, fn: () => Promise<unknown>) => fn(),
    }
    const deps = {
      store: brokenStore as any,
      dataDir: dir,
      homeConfigDir: dir,
      projectDir: dir,
      env: {} as Record<string, string | undefined>,
      modelLimits: new Map([[sid, 100000]]),
      extractionInflight: new Map(),
      lastMessages: new Map(),
      scheduler: { schedule: () => {}, inflight: new Map(), runNow: async () => {} } as any,
      log: () => {},
    }
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    const before = JSON.stringify(raw)
    await runTransform(deps, { messages: raw, sessionID: sid })
    expect(JSON.stringify(raw)).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  test("T10 missing cutoff: rollover cleared, cutoff_missing metric, messages untouched", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, {
      lastContextTokens: 100,
      rollover: {
        epochAtSwap: 0,
        cutoffMessageId: "gone",
        tailMessageIds: [],
        renderText: "<rollover_context epoch='0'>\n\n</rollover_context>",
        lastReply: "",
        appliedAt: 1,
        tokensBefore: 100,
        tokensAfter: 10,
      },
    }))
    const raw = [msg("a1", "assistant", "earlier"), msg("u2", "user", "q")] as any[]
    const before = JSON.stringify(raw)
    await runTransform(deps, { messages: raw, sessionID: sid })
    expect(JSON.stringify(raw)).toBe(before)
    expect((await store.readState(sid))?.rollover).toBeNull()
    const metrics = readFileSync(path.join(dir, sid, "metrics.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ev: string })
    expect(metrics.some((m) => m.ev === "cutoff_missing")).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("T11 rollover command reply does not trigger a swap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" }))
    // /rollover marks its synthetic reply with metadata.source; the model-facing
    // projection keeps that metadata on the message.
    const raw = [
      { id: "a1", role: "assistant", content: [{ type: "text", text: "earlier" }], createdAt: 0 },
      {
        id: "s1",
        role: "user",
        content: [{ type: "text", text: "Komut: /rollover" }],
        metadata: { source: "rollover" },
        createdAt: 0,
      },
    ] as any[]
    const before = JSON.stringify(raw)
    await runTransform(deps, { messages: raw, sessionID: sid })
    expect(JSON.stringify(raw)).toBe(before)
    expect((await store.readState(sid))?.epoch).toBe(0)
    expect((await store.readState(sid))?.decidedUserMessageIds).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test("T6 background wake-up does not swap but keeps the active view", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, {
      epoch: 1,
      lastContextTokens: 2000,
      extractedUntilMessageId: "u1",
      rollover: {
        epochAtSwap: 0,
        cutoffMessageId: "u1",
        tailMessageIds: [],
        renderText: "<rollover_context epoch='0'>\nremember\n\n</rollover_context>",
        lastReply: "",
        appliedAt: 1,
        tokensBefore: 2000,
        tokensAfter: 100,
      },
    }))
    // Wake-up shape captured in P0-6 / fixtures/p0/context-3.json.
    const wake = '<shell id="sh_1e0710c1c001KaPrpYY4Trhjgb" state="completed" command="sleep 3 && echo done">\ndone\n\n</shell>'
    const raw = [
      { id: "u1", role: "user", content: [{ type: "text", text: "start it" }], createdAt: 0 },
      { id: "a1", role: "assistant", content: [{ type: "text", text: "started" }], createdAt: 0 },
      { id: "w1", role: "user", content: [{ type: "text", text: wake }], createdAt: 0 },
    ] as any[]
    await runTransform(deps, { messages: raw, sessionID: sid })
    const st = (await store.readState(sid))!
    expect(st.epoch).toBe(1)
    expect(st.decidedUserMessageIds).toEqual([])
    const joined = JSON.stringify(raw)
    expect(joined).toContain("rollover_context")
    expect(joined).toContain("sh_1e0710c1c001KaPrpYY4Trhjgb")
    expect(joined).toContain("start it")
    rmSync(dir, { recursive: true, force: true })
  })

  test("T7c fresh-copy reapplication tolerates the live multi-assistant step shape", async () => {
    // Live 2.x primary requests carry consecutive assistant rows (step +
    // fingerprint messages, empty first text). Each request gets a fresh copy
    // of the ORIGINAL history (the plugin never persists its rewrite), so the
    // view must reapply cleanly on that shape instead of resetting the record.
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" }))
    const first = [msg("a1", "assistant", "earlier"), msg("u1", "user", "do the work")] as any[]
    await runTransform(deps, { messages: first, sessionID: sid })
    expect((await store.readState(sid))!.epoch).toBe(1)
    const st1 = (await store.readState(sid))!
    expect(st1.rollover).not.toBeNull()

    // Step 2's fresh copy: original history + step messages, consecutive
    // assistants, fingerprint id on the trailing row — the live probe shape.
    const second = [
      msg("a1", "assistant", "earlier"),
      msg("u1", "user", "do the work"),
      msg("a2", "assistant", ""),
      { id: "fp_5a9f6d77", role: "assistant", parts: [{ type: "text", text: "" }], createdAt: 0 },
    ] as any[]
    await runTransform(deps, { messages: second, sessionID: sid })
    const st2 = (await store.readState(sid))!
    expect(st2.rollover).not.toBeNull()
    expect(st2.epoch).toBe(1)
    const metrics = readFileSync(path.join(dir, sid, "metrics.jsonl"), "utf8")
    expect(metrics).not.toContain("cutoff_missing")
    expect(JSON.stringify(second)).toContain("rollover_context")
    rmSync(dir, { recursive: true, force: true })
  })

  test("T7 wake-up after a swap does not re-swap or duplicate the context part", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swap-"))
    await writeCfg(dir)
    const sid = "s1"
    const { deps, store } = makeDeps(dir, sid)
    await store.writeState(sid, state(sid, { lastContextTokens: 2000, extractedUntilMessageId: "a1" }))
    const first = [msg("a1", "assistant", "earlier"), msg("u1", "user", "do the work")] as any[]
    await runTransform(deps, { messages: first, sessionID: sid })
    expect((await store.readState(sid))!.epoch).toBe(1)

    const wake = '<shell id="sh_1" state="completed" command="bun test">\npass\n\n</shell>'
    const second = [
      { id: "a1", role: "assistant", content: [{ type: "text", text: "earlier" }], createdAt: 0 },
      { id: "u1", role: "user", content: [{ type: "text", text: "do the work" }], createdAt: 0 },
      { id: "a2", role: "assistant", content: [{ type: "text", text: "working" }], createdAt: 0 },
      { id: "w1", role: "user", content: [{ type: "text", text: wake }], createdAt: 0 },
    ] as any[]
    await runTransform(deps, { messages: second, sessionID: sid })
    const st = (await store.readState(sid))!
    expect(st.epoch).toBe(1)
    expect(st.decidedUserMessageIds).toEqual(["u1"])
    const joined = JSON.stringify(second)
    expect((joined.match(/<rollover_context /g) ?? []).length).toBe(1)
    expect(joined).toContain("do the work")
    expect(joined).toContain("sh_1")
    expect(joined).not.toContain('"id":"a1"')
    rmSync(dir, { recursive: true, force: true })
  })
})
