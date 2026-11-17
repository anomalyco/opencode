/** Swap-latency performance tests (spec Part B §6 / plan Task 20).
 * Six cases: small history; 500-message history; 5k-line ledger; tail 20;
 * max render budget; 20 repeated invocations. Each case: 20 iterations,
 * report p50/p95/max; release blocker: p95 < 250 ms, max < 5000 ms.
 * The transform path must never invoke the LLM (spy stays at 0). */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runTransform } from "../../src/adapter/opencode/hooks"
import { createStore } from "../../src/adapter/opencode/store"
import { createScheduler } from "../../src/adapter/opencode/scheduler"
import type { LedgerLine, NMessage, RolloverConfig, SessionState } from "../../src/core/types"
import { DEFAULT_CONFIG } from "../../src/core/config"

const ITERATIONS = 20
const samples: Array<{ case: string; ms: number }> = []
const tmpDirs: string[] = []

function tmpRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "perf-"))
  tmpDirs.push(dir)
  return dir
}

function cfgOf(over: Partial<RolloverConfig> = {}): RolloverConfig {
  return { ...DEFAULT_CONFIG, mode: "auto", thresholdTokens: 1000, renderBudgetTokens: 4000, tailN: 0, ...over }
}

function msgs(n: number): NMessage[] {
  const out: NMessage[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `m${String(i).padStart(5, "0")}`,
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `turn ${i}: ${"x".repeat(120)}` }],
      createdAt: 0,
    })
  }
  return out
}

function state(sid: string, over: Partial<SessionState> = {}): SessionState {
  return {
    v: 1, sessionId: sid, settings: {}, epoch: 0, extractedUntilMessageId: null,
    lastContextTokens: 2000, lastContextSource: "usage", lastContextAt: 0, rollover: null,
    decidedUserMessageIds: [], consolidatedAtRecordCount: 0, touchedFiles: {}, ...over,
  }
}

async function writeLedger(dir: string, sid: string, lines: number): Promise<void> {
  const store = createStore({ dataDir: path.join(dir, sid) })
  const chunk: LedgerLine[] = []
  for (let i = 0; i < lines; i++) {
    chunk.push({
      kind: "record",
      id: `r_${String(i).padStart(5, "0")}`,
      type: (["objective", "decision", "user_correction", "open_item", "verification"] as const)[i % 5],
      text: `ledger record ${i}: ${"d".repeat(80)}`,
      epoch: 0,
      userMessageId: "u0",
      turnMessageId: "a0",
      createdAt: 0,
    })
    if (chunk.length === 500) {
      await store.appendLedger(sid, chunk.splice(0))
    }
  }
  if (chunk.length > 0) await store.appendLedger(sid, chunk)
}

async function makeDeps(sid: string, cfg: RolloverConfig, ledgerLines: number) {
  const dir = tmpRoot()
  mkdirSync(path.join(dir, ".opencode"), { recursive: true })
  writeFileSync(path.join(dir, ".opencode", "rollover.json"), JSON.stringify(cfg))
  writeFileSync(path.join(dir, "rollover.json"), JSON.stringify(cfg))
  const store = createStore({ dataDir: path.join(dir, sid) })
  await store.writeState(sid, state(sid, { extractedUntilMessageId: `m${"9".repeat(4)}` }))
  if (ledgerLines > 0) await writeLedger(dir, sid, ledgerLines)
  let llmCalls = 0
  let ledgerReads = 0
  const counting = {
    readLedger: async (s: string) => {
      ledgerReads++
      return store.readLedger(s)
    },
    readState: store.readState.bind(store),
    writeState: store.writeState.bind(store),
    appendLedger: store.appendLedger.bind(store),
    appendMetric: store.appendMetric.bind(store),
  }
  const lastMessages = new Map<string, NMessage[]>()
  const sched = createScheduler({
    store: counting as any,
    getConfig: async () => cfg,
    getMessages: (s) => lastMessages.get(s),
    getState: async (s) => store.readState(s),
    setState: async (s, v) => store.writeState(s, v),
    getSmallModel: () => null,
    getSessionModel: async () => null,
    createLlm: () => ({
      async complete() {
        llmCalls++
        return { text: "{}", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: "m", latencyMs: 0 }
      },
    }),
    metric: async () => {},
    debounceMs: 5,
  })
  const deps = {
    store: counting as any,
    dataDir: dir,
    homeConfigDir: dir,
    projectDir: dir,
    env: {} as Record<string, string | undefined>,
    modelLimits: new Map([[sid, 100000]]),
    extractionInflight: new Map(),
    lastMessages,
    scheduler: sched,
    log: () => {},
  }
  return { deps, getLlmCalls: () => llmCalls, getLedgerReads: () => ledgerReads }
}

async function measure(caseName: string, build: () => Promise<{ deps: any; event: { messages: unknown[]; sessionID: string } }>): Promise<{ p50: number; p95: number; max: number; samples: number[] }> {
  // First call performs the swap (epoch 0 → 1); later iterations exercise the
  // idempotent reapplication path — both are part of the transform contract.
  const { deps, event } = await build()
  const samplesCase: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now()
    await runTransform(deps, event)
    samplesCase.push(performance.now() - t0)
  }
  for (const s of samplesCase) samples.push({ case: caseName, ms: s })
  return {
    p50: percentileCase(samplesCase, 50),
    p95: percentileCase(samplesCase, 95),
    max: Math.max(...samplesCase),
    samples: samplesCase,
  }
}

function percentileCase(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function assertBounds(name: string, r: { p50: number; p95: number; max: number }) {
  expect(r.p95).toBeLessThan(250)
  expect(r.max).toBeLessThan(5000)
}

describe("swap latency (spec B §6)", () => {
  let llmCallsTotal = 0

  test("small history", async () => {
    const sid = "s1"
    const { deps, getLlmCalls } = await makeDeps(sid, cfgOf(), 0)
    const r = await measure("small", async () => ({
      deps,
      event: { messages: msgs(10), sessionID: sid },
    }))
    assertBounds("small", r)
    llmCallsTotal += getLlmCalls()
  })

  test("500-message history", async () => {
    const sid = "s2"
    const { deps, getLlmCalls } = await makeDeps(sid, cfgOf(), 0)
    const r = await measure("history-500", async () => ({
      deps,
      event: { messages: msgs(500), sessionID: sid },
    }))
    assertBounds("history-500", r)
    llmCallsTotal += getLlmCalls()
  })

  test("5k-line ledger", async () => {
    const sid = "s3"
    const { deps, getLlmCalls, getLedgerReads } = await makeDeps(sid, cfgOf(), 5000)
    const r = await measure("ledger-5k", async () => ({
      deps,
      event: { messages: msgs(20), sessionID: sid },
    }))
    assertBounds("ledger-5k", r)
    // the ledger must be read once per transform, not per iteration effect
    expect(getLedgerReads()).toBeLessThanOrEqual(ITERATIONS + 1)
    llmCallsTotal += getLlmCalls()
  })

  test("tail 20", async () => {
    const sid = "s4"
    const { deps, getLlmCalls } = await makeDeps(sid, cfgOf({ tailN: 20 }), 0)
    const r = await measure("tail-20", async () => ({
      deps,
      event: { messages: msgs(500), sessionID: sid },
    }))
    assertBounds("tail-20", r)
    llmCallsTotal += getLlmCalls()
  })

  test("max render budget", async () => {
    const sid = "s5"
    const { deps, getLlmCalls } = await makeDeps(sid, cfgOf({ renderBudgetTokens: 100_000 }), 5000)
    const r = await measure("render-max", async () => ({
      deps,
      event: { messages: msgs(50), sessionID: sid },
    }))
    assertBounds("render-max", r)
    llmCallsTotal += getLlmCalls()
  })

  test("20 repeated invocations", async () => {
    const sid = "s6"
    const { deps, getLlmCalls } = await makeDeps(sid, cfgOf(), 200)
    const r = await measure("repeat-20", async () => ({
      deps,
      event: { messages: [...msgs(60), { id: "m99999", role: "user", parts: [{ type: "text", text: "latest" }], createdAt: 0 }], sessionID: sid },
    }))
    assertBounds("repeat-20", r)
    llmCallsTotal += getLlmCalls()
  })

  afterAll(() => {
    // The transform path must never invoke an LLM (spec §1 contract).
    expect(llmCallsTotal).toBe(0)
    const all = samples.map((s) => s.ms)
    const report = {
      p50: percentileCase(all, 50),
      p95: percentileCase(all, 95),
      max: Math.max(...all),
      samples,
    }
    writeFileSync(path.join(import.meta.dir, "last-run.json"), JSON.stringify(report, null, 2))
    rmSync(path.join(tmpdir(), "perf-"), { recursive: true, force: true })
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  })
})
