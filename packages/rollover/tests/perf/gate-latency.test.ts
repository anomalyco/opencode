/** Gate overhead performance tests (task §10.E).
 * Cases: classify() across the 20 experiment messages; the full gate decision
 * (deriveGateInputs + classify + shouldRun) on a 500-message history; a full
 * SKIP-turn onIdle (gate decision only — real metric writes, zero LLM calls);
 * a scheduled-turn onIdle including the extraction round-trip to an instant
 * mock LLM.
 * The deterministic gate must add negligible overhead relative to the LLM
 * extraction it gates (measured baseline mean ≈ 21 s/call): release bounds
 * p95 < 10 ms for gate-only decisions, p95 < 50 ms for a scheduled idle. */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { classify, deriveGateInputs, shouldRun } from "../../src/core/gate"
import { createScheduler } from "../../src/adapter/opencode/scheduler"
import { createStore } from "../../src/adapter/opencode/store"
import type { MetricEvent, NMessage, SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"
import fixture from "../fixtures/gate/replay-20-turns.json"

const tmpDirs: string[] = []
const report: Record<string, unknown> = {}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function summarize(samples: number[]): { p50: number; p95: number; max: number; n: number } {
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples), n: samples.length }
}

function msgs(n: number, text: string): NMessage[] {
  const out: NMessage[] = []
  for (let i = 0; i < n; i++) {
    out.push({ id: `u${String(i).padStart(4, "0")}`, role: "user", parts: [{ type: "text", text }], createdAt: i })
    out.push({ id: `a${String(i).padStart(4, "0")}`, role: "assistant", parts: [{ type: "text", text: `reply ${i}` }], createdAt: i })
  }
  return out
}

function state(sid: string, cursor: string | null): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: cursor,
    lastContextTokens: 0, lastContextSource: "estimate", lastContextAt: 0, rollover: null,
    decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {},
  }
}

describe("gate overhead (spec §10.E)", () => {
  test("classify latency across the 20 experiment messages", () => {
    const samples: number[] = []
    for (let i = 0; i < 2000; i++) {
      for (const text of fixture.messages) {
        const t0 = performance.now()
        classify(text)
        samples.push((performance.now() - t0) * 1000) // µs
      }
    }
    const s = summarize(samples)
    report.classify_us = s
    expect(s.p95).toBeLessThan(1000) // < 1 ms per classification
  })

  test("full gate decision on a 500-message history", () => {
    const history = msgs(500, fixture.messages[9])
    const samples: number[] = []
    let decision = false
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now()
      const inputs = deriveGateInputs(history, "a0499") // caught up: nothing pending
      if (inputs) {
        const c = classify(inputs.userText)
        decision = shouldRun(c.cls, c.decision, c.urgent, inputs.counter, inputs.lastRunWasPreviousTurn).run
      }
      samples.push(performance.now() - t0)
    }
    expect(decision).toBe(false) // cursor at the end → nothing pending → no run
    const s = summarize(samples)
    report.gate_decision_500msgs_ms = s
    expect(s.p95).toBeLessThan(10)
  })

  test("SKIP-turn onIdle: gate decision only, zero LLM calls", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-perf-"))
    tmpDirs.push(dir)
    const store = createStore({ dataDir: dir })
    const sid = "perf-skip"
    await store.writeState(sid, state(sid, null))
    const history = [...msgs(249, "What is a tuple?"), ...msgs(1, "Thanks, that helps.")]
    let llmCalls = 0
    const events: MetricEvent[] = []
    const sched = createScheduler({
      store: store as Parameters<typeof createScheduler>[0]["store"],
      getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
      getMessages: () => history,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          llmCalls++
          return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 0 }
        },
      }),
      metric: async (s, ev) => {
        events.push(ev)
        await store.appendMetric(s, ev)
      },
      debounceMs: 5,
    })
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await sched.onIdle(sid)
      samples.push(performance.now() - t0)
    }
    expect(llmCalls).toBe(0) // the gate decided SKIP every time — no extraction, no LLM
    expect(events.filter((e) => e.ev === "gate_classified").length).toBe(20)
    const s = summarize(samples)
    report.onIdle_skip_turn_ms = s
    expect(s.p95).toBeLessThan(10)
  })

  test("scheduled-turn onIdle: gate + extraction round-trip to an instant mock LLM", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-perf-"))
    tmpDirs.push(dir)
    const store = createStore({ dataDir: dir })
    const sid = "perf-run"
    await store.writeState(sid, state(sid, null))
    // 500 pending turns, latest is a decision → gate schedules, extraction runs
    const history = [...msgs(499, "What is a tuple?"), ...msgs(1, "We decided to use PostgreSQL.")]
    const sched = createScheduler({
      store: store as Parameters<typeof createScheduler>[0]["store"],
      getConfig: async () => ({ ...DEFAULT_CONFIG, mode: "auto" }),
      getMessages: () => history,
      getState: async () => store.readState(sid),
      setState: async (s, v) => store.writeState(s, v),
      getSmallModel: () => null,
      getSessionModel: async () => null,
      createLlm: () => ({
        async complete() {
          return { text: '{"records":[]}', usage: null, model: "m", latencyMs: 0 }
        },
      }),
      metric: async (s, ev) => store.appendMetric(s, ev),
      debounceMs: 5,
    })
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await sched.onIdle(sid)
      samples.push(performance.now() - t0)
      // keep the scenario constant: reset the cursor so every idle schedules again
      const st = await store.readState(sid)
      await store.writeState(sid, { ...st!, extractedUntilMessageId: null })
    }
    const s = summarize(samples)
    report.onIdle_scheduled_turn_500msgs_ms = s
    expect(s.p95).toBeLessThan(50)
  })

  afterAll(() => {
    writeFileSync(path.join(import.meta.dir, "last-gate-run.json"), JSON.stringify(report, null, 2))
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  })
})
