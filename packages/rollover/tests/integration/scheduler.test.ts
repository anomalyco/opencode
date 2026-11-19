import { describe, expect, test } from "bun:test"
import { createScheduler } from "../../src/adapter/opencode/scheduler"
import { createStore } from "../../src/adapter/opencode/store"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { NMessage, RolloverConfig, SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"

const cfg: RolloverConfig = {
  ...DEFAULT_CONFIG,
  mode: "auto",
  consolidateAfterRecords: 100,
  extractionDeltaMaxTokens: 12000,
}

function msg(id: string, role: "user" | "assistant", text: string): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0 }
}

function state(sid: string): SessionState {
  return {
    v: 1,
    sessionId: sid,
    settings: {},
    epoch: 0,
    extractedUntilMessageId: null,
    lastContextTokens: 0,
    lastContextSource: "estimate",
    lastContextAt: 0,
    rollover: null,
    decidedUserMessageIds: [],
    consolidatedAtRecordCount: 0,
    touchedFiles: {},
  }
}

describe("scheduler", () => {
  test("onIdle extracts every turn without the gate (closure turns extract too)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    let llmCalls = 0
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => [msg("u1", "user", "thanks"), msg("a1", "assistant", "you're welcome")],
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          return {
            text: '{"records":[]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async () => {},
      debounceMs: 60_000,
    })
    await sched.onIdle(sid)
    expect(llmCalls).toBe(1)
    const st = (await store.readState(sid))!
    expect(st.extractedUntilMessageId).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("after a swap, extraction refreshes the frozen render from ledger records (cutoff/epoch untouched)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    const msgs = [
      msg("u1", "user", "which library?"),
      msg("a1", "assistant", "chose left-pad"),
      msg("u2", "user", "next prompt"),
    ]
    const base = state(sid)
    base.epoch = 1
    base.rollover = {
      epochAtSwap: 1,
      cutoffMessageId: "u2",
      tailMessageIds: [],
      renderText: "<rollover_context epoch='1'>\nmechanical only\n</rollover_context>",
      lastReply: "",
      appliedAt: 1,
      tokensBefore: 100,
      tokensAfter: 10,
    }
    await store.writeState(sid, base)
    const metrics: string[] = []
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => msgs,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          return {
            text: '{"records":[{"type":"decision","text":"Use left-pad.","rationale":"smaller"}]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async (_sid, ev) => {
        metrics.push(ev.ev)
      },
      debounceMs: 60_000,
    })
    await sched.runNow(sid)
    const st = (await store.readState(sid))!
    expect(st.rollover!.epochAtSwap).toBe(1)
    expect(st.rollover!.cutoffMessageId).toBe("u2")
    expect(st.rollover!.renderText).toContain("## Decisions")
    expect(st.rollover!.renderText).toContain("Use left-pad.")
    expect(st.rollover!.renderText).toContain("## User prompts")
    expect(metrics).toContain("ledger_enriched")
    const before = st.rollover!.renderText
    // second run with nothing new → byte-identical render (idempotent refresh)
    await sched.runNow(sid)
    const st2 = (await store.readState(sid))!
    expect(st2.rollover!.renderText).toBe(before)
    expect(st2.rollover!.cutoffMessageId).toBe("u2")
    expect(st2.rollover!.epochAtSwap).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("runNow awaited at idle commits without depending on the debounce timer", async () => {
    // The idle hook handler awaits runNow — extraction must commit even when
    // the debounce window outlives the (short-lived) host process.
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    let llmCalls = 0
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")],
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          return {
            text: '{"records":[]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async () => {},
      debounceMs: 60_000,
    })
    await sched.runNow(sid)
    expect(llmCalls).toBe(1)
    const st = (await store.readState(sid))!
    expect(st.extractedUntilMessageId).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  test("runNow during an in-flight run coalesces instead of racing a second run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    let started = 0
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")],
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          started++
          if (started === 1) await gate
          return {
            text: '{"records":[]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async () => {},
      debounceMs: 5,
    })
    const first = sched.runNow(sid)
    await new Promise((r) => setTimeout(r, 10))
    const second = sched.runNow(sid)
    let settled = false
    void second.then(() => {
      settled = true
    })
    release!()
    await first
    await second
    expect(started).toBe(1)
    expect(settled).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("debounce coalesces rapid triggers into one run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    const st = state(sid)
    await store.writeState(sid, st)
    const msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    let llmCalls = 0
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => msgs,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          await new Promise((r) => setTimeout(r, 20))
          return {
            text: '{"records":[{"type":"objective","text":"did hi"}]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async () => {},
      debounceMs: 20,
    })
    sched.schedule(sid)
    sched.schedule(sid)
    sched.schedule(sid)
    await new Promise((r) => setTimeout(r, 120))
    expect(llmCalls).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("inflight trigger re-queues one run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sched-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    const st = state(sid)
    await store.writeState(sid, st)
    let msgs = [msg("u1", "user", "hi"), msg("a1", "assistant", "ok")]
    let llmCalls = 0
    const sched = createScheduler({
      store: store as any,
      getConfig: async () => cfg,
      getMessages: () => msgs,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          await new Promise((r) => setTimeout(r, 40))
          return {
            text: '{"records":[{"type":"objective","text":"did hi"}]}',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            model: "m",
            latencyMs: 1,
          }
        },
      }),
      metric: async () => {},
      debounceMs: 5,
    })
    const first = sched.runNow(sid)
    // trigger while in-flight → should re-queue
    sched.schedule(sid)
    await first
    // reset cursor + new msgs for the re-queued run
    const s = await store.readState(sid)
    await store.writeState(sid, { ...s!, extractedUntilMessageId: null })
    msgs = [msg("u2", "user", "hi2"), msg("a2", "assistant", "ok2")]
    await new Promise((r) => setTimeout(r, 120))
    expect(llmCalls).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })
})
