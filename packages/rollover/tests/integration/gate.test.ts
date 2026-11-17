import { describe, expect, test } from "bun:test"
import { createScheduler } from "../../src/adapter/opencode/scheduler"
import { createStore } from "../../src/adapter/opencode/store"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { MetricEvent, NMessage, RolloverConfig, SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"

function msg(id: string, role: "user" | "assistant", text: string): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0 }
}

function state(sid: string): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: null,
    lastContextTokens: 0, lastContextSource: "estimate", lastContextAt: 0, rollover: null,
    decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {},
  }
}

/** Harness: the projected history grows one (user, assistant) pair per turn,
 * exactly like the idle hook refreshing lastMessages from session context. */
async function harness(opts: {
  cfg?: Partial<RolloverConfig>
  llmText?: string | ((attempt: number) => string)
  messages?: string[]
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-"))
  const store = createStore({ dataDir: dir })
  const sid = "s1"
  await store.writeState(sid, state(sid))
  const cfg: RolloverConfig = { ...DEFAULT_CONFIG, mode: "auto", consolidateAfterRecords: 100, ...opts.cfg }
  const messages = opts.messages ?? ["What is a tuple?", "Thanks, that helps.", "We decided to use PostgreSQL.", "We must keep the API stable.", "I started a background benchmark. It is still running.", "The benchmark completed. All tests pass."]
  const turns: NMessage[][] = []
  let current = 0
  let llmCalls = 0
  const prompts: string[] = []
  const events: MetricEvent[] = []
  const refresh = () => {
    const msgs: NMessage[] = []
    for (let t = 1; t <= current; t++) {
      msgs.push(msg(`u${t}`, "user", messages[t - 1]))
      msgs.push(msg(`a${t}`, "assistant", `reply ${t}`))
    }
    turns[0] = msgs
    return msgs
  }
  const sched = createScheduler({
    store: store as Parameters<typeof createScheduler>[0]["store"],
    getConfig: async () => cfg,
    getMessages: () => (current === 0 ? undefined : turns[0]),
    getState: async () => store.readState(sid),
    setState: async (s, v) => store.writeState(s, v),
    getSmallModel: () => null,
    getSessionModel: async () => null,
    createLlm: () => ({
      async complete(req) {
        llmCalls++
        prompts.push(req.user)
        const text = typeof opts.llmText === "function" ? opts.llmText(llmCalls) : (opts.llmText ?? '{"records":[]}')
        return { text, usage: null, model: "m", latencyMs: 1 }
      },
    }),
    metric: async (s, ev) => {
      events.push(ev)
    },
    debounceMs: 5,
  })
  return {
    sched,
    store,
    sid,
    cfg,
    events,
    prompts,
    messagesList: messages,
    llmCalls: () => llmCalls,
    cursor: async () => (await store.readState(sid))?.extractedUntilMessageId ?? null,
    async turn(n: number) {
      current = n
      refresh()
      await sched.onIdle(sid)
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function evOf(events: MetricEvent[], ev: string): MetricEvent[] {
  return events.filter((e) => e.ev === ev)
}

describe("gate scheduler integration (onIdle)", () => {
  test("SKIP turns accumulate: no extraction, cursor stays, content rides later", async () => {
    const h = await harness({})
    await h.turn(1)
    expect(h.llmCalls()).toBe(0)
    expect(await h.cursor()).toBeNull()
    expect(evOf(h.events, "gate_classified")[0].decision).toBe("SKIP")
    expect(evOf(h.events, "gate_classified")[0].matched).toBeDefined()
    await h.turn(2)
    expect(h.llmCalls()).toBe(0)
    expect(evOf(h.events, "gate_classified").length).toBe(2)
    h.cleanup()
  })

  test("gate classifies Turkish messages and emits matched", async () => {
    const h = await harness({ messages: ["Teşekkürler.", "Bu projede her zaman TypeScript kullanacağız."] })
    await h.turn(1)
    expect(h.llmCalls()).toBe(0)
    const first = evOf(h.events, "gate_classified")[0]
    expect(first.cls).toBe("closure")
    expect(first.matched).toBe("tr")
    await h.turn(2)
    // first run ever: cursor null → counter ∞ → the standing instruction runs
    expect(h.llmCalls()).toBe(1)
    const second = evOf(h.events, "gate_classified")[1]
    expect(second.cls).toBe("standing")
    expect(second.matched).toBe("tr")
    h.cleanup()
  })

  test("EXTRACT after SKIPs runs once with the accumulated delta, then advances the cursor", async () => {
    const h = await harness({})
    await h.turn(1)
    await h.turn(2)
    await h.turn(3) // decision → counter 3 → run
    expect(h.llmCalls()).toBe(1)
    expect(evOf(h.events, "gate_scheduled").length).toBe(1)
    expect(evOf(h.events, "extraction_completed").length).toBe(1)
    // delta covers all three unprocessed user turns, not just the latest
    for (const t of [1, 2, 3]) expect(h.prompts[0]).toContain(messagesOf(h)[t - 1])
    expect(await h.cursor()).toBe("a3")
    h.cleanup()
  })

  test("positive candidate right after a run coalesces; the next turn runs with both contents", async () => {
    const h = await harness({})
    await h.turn(3) // decision, counter ∞ → run
    const runsAfterFirst = h.llmCalls()
    expect(runsAfterFirst).toBe(1)
    await h.turn(4) // constraint, counter 1 → coalesced
    expect(h.llmCalls()).toBe(1)
    expect(evOf(h.events, "gate_coalesced").length).toBe(1)
    expect(evOf(h.events, "gate_scheduled").length).toBe(1)
    expect(await h.cursor()).toBe("a3")
    await h.turn(5) // process_start → DEFER never runs; coalesced turn 4 still pending
    expect(h.llmCalls()).toBe(1)
    expect(await h.cursor()).toBe("a3")
    await h.turn(6) // completion → always run; delta covers 4, 5, 6
    expect(h.llmCalls()).toBe(2)
    for (const t of [4, 5, 6]) expect(h.prompts[1]).toContain(messagesOf(h)[t - 1])
    expect(await h.cursor()).toBe("a6")
    h.cleanup()
  })

  test("DEFER start never runs alone; its completion event triggers one run covering both", async () => {
    const h = await harness({})
    await h.turn(5) // DEFER
    expect(h.llmCalls()).toBe(0)
    expect(evOf(h.events, "gate_classified")[0].decision).toBe("DEFER")
    expect(await h.cursor()).toBeNull()
    await h.turn(6) // completion
    expect(h.llmCalls()).toBe(1)
    expect(h.prompts[0]).toContain(messagesOf(h)[4])
    expect(h.prompts[0]).toContain(messagesOf(h)[5])
    h.cleanup()
  })

  test("multiple consecutive DEFERs accumulate and all ride in the completion run", async () => {
    const msgs = [
      "I started a background benchmark. It is still running.",
      "Started a second background job for the docs render. Still in progress.",
      "The benchmark completed. All tests pass.",
    ]
    const h = await harness({ messages: msgs })
    await h.turn(1) // DEFER
    expect(h.llmCalls()).toBe(0)
    await h.turn(2) // DEFER again — still no run
    expect(h.llmCalls()).toBe(0)
    expect(await h.cursor()).toBeNull()
    await h.turn(3) // completion → one run covering both deferred starts and the completion
    expect(h.llmCalls()).toBe(1)
    expect(h.prompts[0]).toContain(msgs[0])
    expect(h.prompts[0]).toContain(msgs[1])
    expect(h.prompts[0]).toContain(msgs[2])
    expect(await h.cursor()).toBe("a3")
    h.cleanup()
  })

  test("runNow bypasses the gate: the /rollover immediate catch-up stays ungated", async () => {
    const h = await harness({})
    await h.turn(1) // question → gate skips
    expect(h.llmCalls()).toBe(0)
    await h.sched.runNow(h.sid) // explicit path (runImmediateSwap uses this)
    expect(h.llmCalls()).toBe(1)
    expect(await h.cursor()).toBe("a1")
    h.cleanup()
  })

  test("duplicate idle after a successful run is a no-op", async () => {
    const h = await harness({})
    await h.turn(3)
    expect(h.llmCalls()).toBe(1)
    const sched = h.sched
    await sched.onIdle(h.sid) // same turn, already caught up
    await sched.onIdle(h.sid)
    expect(h.llmCalls()).toBe(1)
    h.cleanup()
  })

  test("failed extraction keeps the cursor and retries on the next idle", async () => {
    // run 1: both internal attempts fail; run 2 (next idle): first attempt fails, second parses
    const h = await harness({ llmText: (attempt) => (attempt <= 2 ? "not json at all" : '{"records":[]}') })
    await h.turn(3)
    expect(h.llmCalls()).toBe(2)
    expect(evOf(h.events, "extraction_failed").length).toBe(1)
    expect(await h.cursor()).toBeNull()
    await h.turn(4) // cursor still null → counter ∞ → runs again
    expect(h.llmCalls()).toBe(3)
    expect(evOf(h.events, "extraction_completed").length).toBe(1)
    expect(await h.cursor()).toBe("a4")
    h.cleanup()
  })

  test("gate disabled → extraction on every idle (pre-gate behavior)", async () => {
    const h = await harness({ cfg: { extractionGate: false } })
    await h.turn(1)
    expect(h.llmCalls()).toBe(1)
    await h.turn(2)
    expect(h.llmCalls()).toBe(2)
    expect(evOf(h.events, "gate_classified").length).toBe(0)
    h.cleanup()
  })

  test("fail-open: gate errors fall back to extraction and never skip silently", async () => {
    // The gate path fails (its metric write throws); the extraction path stays
    // healthy — the session must extract anyway, never treat the error as a SKIP.
    const dir = mkdtempSync(path.join(tmpdir(), "gate-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    const events: MetricEvent[] = []
    const msgs = [msg("u1", "user", "Thanks, that helps."), msg("a1", "assistant", "ok"), msg("u2", "user", "We decided to use PostgreSQL."), msg("a2", "assistant", "ok")]
    let llmCalls = 0
    const sched = createScheduler({
      store: store as Parameters<typeof createScheduler>[0]["store"],
      getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
      getMessages: () => msgs,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 1 }
        },
      }),
      metric: async (s, ev) => {
        if (ev.ev === "gate_classified") throw new Error("metric write failed")
        events.push(ev)
      },
      debounceMs: 5,
    })
    await sched.onIdle(sid)
    expect(llmCalls).toBe(1) // fallback ran the extraction
    expect(evOf(events, "gate_fallback").length).toBe(1)
    expect(evOf(events, "extraction_completed").length).toBe(1)
    expect((await store.readState(sid))?.extractedUntilMessageId).toBe("a2")
    rmSync(dir, { recursive: true, force: true })
  })

  test("concurrent onIdle calls coalesce into one run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    const msgs = [msg("u1", "user", "We decided to use PostgreSQL."), msg("a1", "assistant", "ok")]
    let llmCalls = 0
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => { release = r })
    const events: MetricEvent[] = []
    const sched = createScheduler({
      store: store as Parameters<typeof createScheduler>[0]["store"],
      getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
      getMessages: () => msgs,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          await gate
          return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 1 }
        },
      }),
      metric: async (s, ev) => {
      events.push(ev)
    },
      debounceMs: 5,
    })
    const first = sched.onIdle(sid)
    const second = sched.onIdle(sid)
    release!()
    await Promise.all([first, second])
    expect(llmCalls).toBe(1)
    expect(evOf(events, "gate_scheduled").length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test("restart recovery: a fresh scheduler instance honors the persisted cursor", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-"))
    const store = createStore({ dataDir: dir })
    const sid = "s1"
    await store.writeState(sid, state(sid))
    const messages = ["Thanks.", "We decided to use PostgreSQL.", "The benchmark completed. All tests pass."]
    let llmCalls = 0
    const prompts: string[] = []
    const mk = () =>
      createScheduler({
        store: store as Parameters<typeof createScheduler>[0]["store"],
        getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
        getMessages: () => {
          const out: NMessage[] = []
          for (let t = 1; t <= 3; t++) {
            out.push(msg(`u${t}`, "user", messages[t - 1]))
            out.push(msg(`a${t}`, "assistant", `reply ${t}`))
          }
          return out
        },
        getState: async () => store.readState(sid),
        setState: async (s, v) => store.writeState(s, v),
        getSmallModel: () => null,
        getSessionModel: async () => null,
        createLlm: () => ({
          async complete(req) {
            llmCalls++
            prompts.push(req.user)
            return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 1 }
          },
        }),
        metric: async () => {},
        debounceMs: 5,
      })
    const first = mk()
    await first.onIdle(sid) // u3 completion, counter ∞ → run covering 1–3
    expect(llmCalls).toBe(1)
    expect(prompts[0]).toContain(messages[0])
    expect((await store.readState(sid))?.extractedUntilMessageId).toBe("a3")
    // process restart: new in-memory scheduler, same persisted state
    const second = mk()
    await second.onIdle(sid)
    expect(llmCalls).toBe(1) // nothing pending → no duplicate extraction
    rmSync(dir, { recursive: true, force: true })
  })

  test("metrics carry classification detail and pending gauges", async () => {
    const h = await harness({})
    await h.turn(3)
    const c = evOf(h.events, "gate_classified")[0] as MetricEvent & {
      cls: string; decision: string; urgent: boolean; rule: string; pendingMessages: number; pendingTokens: number
    }
    expect(c.cls).toBe("decision")
    expect(c.decision).toBe("EXTRACT")
    expect(c.urgent).toBe(false)
    expect(c.rule.startsWith("R5")).toBe(true)
    expect(c.pendingMessages).toBe(6)
    expect(c.pendingTokens).toBeGreaterThan(0)
    h.cleanup()
  })
})

function messagesOf(h: Awaited<ReturnType<typeof harness>>): string[] {
  return h.messagesList
}
