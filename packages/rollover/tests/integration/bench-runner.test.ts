import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import {
  SCENARIO_IDS,
  buildMockScript,
  classifyRequest,
  computeCost,
  loadHidden,
  loadPricing,
  loadSeed,
  runScenario,
  summarizeRequests,
} from "../../bench/runner"
import { percentile, renderReport, type BenchMeta } from "../../bench/report"

const PKG_ROOT = path.resolve(import.meta.dir, "../..")

describe("bench assets", () => {
  test("all ten seeds parse and are structurally valid", async () => {
    for (const id of SCENARIO_IDS) {
      const seed = await loadSeed(id)
      expect(seed.id).toBe(id)
      expect(seed.turns.length).toBeGreaterThanOrEqual(3)
      for (const t of seed.turns) {
        expect(t.prompt.length).toBeGreaterThan(0)
        expect(typeof t.script.content).toBe("string")
      }
      if (!existsSync(path.join(PKG_ROOT, "bench/prompts", `${id}.txt`))) {
        throw new Error(`missing prompts file for ${id}`)
      }
    }
  })

  test("prompts files match the seed turn order", async () => {
    for (const id of SCENARIO_IDS) {
      const seed = await loadSeed(id)
      const text = await Bun.file(path.join(PKG_ROOT, "bench/prompts", `${id}.txt`)).text()
      const lines = text.split("\n").filter(Boolean)
      expect(lines.length).toBe(seed.turns.length)
      expect(lines[0]).toBe(seed.turns[0].prompt)
    }
  })

  test("hidden files parse with facts and flags", async () => {
    for (const id of SCENARIO_IDS) {
      const h = await loadHidden(id)
      expect(h.id).toBe(id)
      expect(Array.isArray(h.facts)).toBe(true)
      expect(h.facts.length).toBeGreaterThanOrEqual(1)
      expect(typeof h.requiresRuntimeEvidence).toBe("boolean")
    }
    // env-dependent scenarios are marked per the plan
    const b7 = await loadHidden("B7")
    const b8 = await loadHidden("B8")
    const b10 = await loadHidden("B10")
    expect(b7.requiresRuntimeEvidence).toBe(true)
    expect(b8.requiresRuntimeEvidence).toBe(true)
    expect(b10.requiresRuntimeEvidence).toBe(true)
  })

  test("mock script leads with extraction/consolidation answers", async () => {
    const seed = await loadSeed("B2")
    const script = buildMockScript(seed)
    expect(script.length).toBe(seed.turns.length + 2)
    expect(JSON.parse(script[0].content)).toHaveProperty("records")
    expect(JSON.parse(script[1].content)).toEqual({ invalidate: [] })
  })

  test("B6 extraction override returns unparseable JSON", async () => {
    const seed = await loadSeed("B6")
    const script = buildMockScript(seed)
    expect(script[0].content).not.toMatch(/^\s*[{\[]/)
  })
})

describe("bench pure helpers", () => {
  test("classifyRequest separates extraction/consolidation/conversation", () => {
    expect(classifyRequest({ messages: [{ role: "user", content: "You maintain a durable memory ledger\n\nDELTA:x" }] })).toBe("extraction")
    expect(classifyRequest({ messages: [{ role: "user", content: "You clean a memory ledger\n\nid|1" }] })).toBe("consolidation")
    expect(classifyRequest({ messages: [{ role: "user", content: "hello" }] })).toBe("conversation")
  })

  test("summarizeRequests totals tokens and excludes aux calls from peak context", () => {
    const summary = summarizeRequests([
      { body: { messages: [{ role: "user", content: "hi" }] }, usage: { input: 1000, output: 10 } },
      { body: { messages: [{ role: "user", content: "You maintain a durable memory ledger DELTA" }] }, usage: { input: 500, output: 5 } },
      { body: { messages: [{ role: "user", content: "hi again with more context" }] }, usage: { input: 2000, output: 20, cacheRead: 300 } },
    ])
    expect(summary.llmCalls).toBe(3)
    expect(summary.extractionCalls).toBe(1)
    expect(summary.tokens.input).toBe(3500)
    expect(summary.peakContextTokens).toBe(2000)
  })

  test("computeCost is null for unknown models and correct for priced ones", () => {
    const tokens = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }
    expect(computeCost("mockllm/test-model", tokens)).toBeNull()
    const cost = computeCost("test/priced", tokens, { "test/priced": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 } })
    expect(cost).toBeCloseTo(3 + 1.5, 6)
  })

  test("percentile uses nearest-rank", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30)
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50)
    expect(percentile([], 50)).toBe(0)
  })
})

describe("runScenario guards (no binary needed)", () => {
  test("refuses a sandbox outside the opencode-rollover- prefix", async () => {
    const res = await runScenario({ scenario: "B1", mode: "experimental", sandboxDir: "/tmp/elsewhere" })
    expect(res.ok).toBe(false)
    expect(res.error).toContain("prefix")
  })

  test("refuses a binary outside the fork tree", async () => {
    const res = await runScenario({
      scenario: "B1",
      mode: "experimental",
      sandboxDir: path.join("/tmp", `opencode-rollover-test-${process.pid}`),
      bin: "/usr/local/bin/opencode",
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain("fork tree")
  })
})

const binAvailable = !!process.env.OPENCODE_BIN && existsSync(process.env.OPENCODE_BIN)
const benchDescribe = binAvailable ? describe : describe.skip

benchDescribe("bench smoke (OPENCODE_BIN gated)", () => {
  test("B2 experimental produces rollovers; baseline produces none", async () => {
    const bin = process.env.OPENCODE_BIN!
    const root = path.join(process.env.TMPDIR ?? "/tmp", `opencode-rollover-bench-${process.pid}`)
    const exp = await runScenario({ scenario: "B2", mode: "experimental", sandboxDir: path.join(root, "exp"), bin })
    expect(exp.ok).toBe(true)
    expect(exp.rollovers.ok).toBeGreaterThan(0)
    expect(exp.epochs).toBeGreaterThanOrEqual(1)
    expect(exp.peakContextTokens).toBeGreaterThan(0)
    expect(exp.tokens.input).toBeGreaterThan(0)
    const base = await runScenario({ scenario: "B2", mode: "baseline", sandboxDir: path.join(root, "base"), bin })
    expect(base.ok).toBe(true)
    expect(base.rollovers.ok).toBe(0)
    expect(base.epochs).toBe(0)
    expect(base.peakContextTokens).toBeGreaterThan(exp.peakContextTokens)
  }, 240_000)
})

describe("report rendering", () => {
  const meta: BenchMeta = {
    opencodeVersion: "test",
    forkCommit: "e3ed63c7de",
    model: "mockllm/test-model",
    hardware: "test-runner",
    configSummary: "threshold=1000",
    generatedAt: "2026-11-16T00:00:00Z",
  }

  test("contains every spec §7.6 section and labels not-run scenarios", () => {
    const md = renderReport(meta, [])
    for (const field of ["OpenCode", "Model", "Hardware", "Datasets", "Baseline", "Experimental", "savings", "Cost", "latency", "retention", "Failed scenarios", "Limitations"]) {
      expect(md.toLowerCase()).toContain(field.toLowerCase())
    }
    expect(md).toContain("not run")
    expect(md).toContain("B1")
  })

  test("lists a failed scenario with its error", () => {
    const md = renderReport(meta, [{ scenario: "B1", mode: "baseline", ok: false, error: "boom", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null, peakContextTokens: 0, llmCalls: 0, extractionCalls: 0, consolidationCalls: 0, extractionMs: 0, consolidationMs: 0, swapLatenciesMs: [], contextReductions: [], rollovers: { ok: 0, deferred: 0, failed: 0 }, epochs: 0, sessionIDs: [] }])
    expect(md).toContain("B1 (baseline): boom")
  })

  test("pricing table default stays empty (no invented prices)", () => {
    expect(Object.keys(loadPricing()).length).toBe(0)
  })
})
