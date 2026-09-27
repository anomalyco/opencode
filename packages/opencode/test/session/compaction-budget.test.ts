import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Schema } from "effect"
import {
  COMPACTION_BUFFER,
  describeCompactionCheck,
  formatCompactionCheck,
  getCompactionBudget,
  getRequestedOutputTokens,
  getReservedOutputTokens,
  getUsedTokens,
  isOverflow,
  normalizeLimits,
  shouldCompact,
  usable,
} from "../../src/session/overflow"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

function baseCfg(compaction?: ConfigV1.Info["compaction"]): ConfigV1.Info {
  const base = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info
  return { ...base, compaction }
}

function makeModel(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "space-bunny",
    providerID: "test",
    name: "Space Bunny",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function tokensFor(total: number) {
  return {
    input: total,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
}

const SPACE_BUNNY = { context: 1_048_576, output: 524_288 }

describe("compaction budget — Space Bunny regression (generic, no model hack)", () => {
  test("Test 1 — Space Bunny does not compact at 16.6k", () => {
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    // Usable must remain ~1M (context minus bounded 20k reservation), not 16k.
    expect(budget).toBeGreaterThan(900_000)
    expect(isOverflow({ cfg, model, tokens: tokensFor(16_600) })).toBe(false)
    expect(shouldCompact({ usedTokens: 16_600, budget })).toBe(false)
  })

  test("Test 2 — Space Bunny below legitimate threshold", () => {
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    const below = Math.floor(budget * 0.5)
    expect(isOverflow({ cfg, model, tokens: tokensFor(below) })).toBe(false)
  })

  test("Test 3 — Space Bunny near legitimate threshold compacts", () => {
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    // Derive expectation from the budgeting function itself, not a hardcoded constant.
    expect(isOverflow({ cfg, model, tokens: tokensFor(budget - 1) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(budget) })).toBe(true)
    expect(isOverflow({ cfg, model, tokens: tokensFor(budget + 1_000) })).toBe(true)
  })

  test("Test 4 — normal small-context model (32k)", () => {
    const model = makeModel({ context: 32_000, output: 8_000 })
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    // Requested output = min(8k, 32k) = 8k; reserved = min(20k, 8k) = 8k; budget = 24k.
    expect(budget).toBe(24_000)
    expect(isOverflow({ cfg, model, tokens: tokensFor(10_000) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(24_000) })).toBe(true)
  })

  test("Test 5 — medium model (128k)", () => {
    const model = makeModel({ context: 128_000, output: 32_000 })
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    // Requested 32k, reserved 20k, budget 108k.
    expect(budget).toBe(108_000)
    expect(isOverflow({ cfg, model, tokens: tokensFor(50_000) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(108_000) })).toBe(true)
  })

  test("Test 6 — 1M context model not truncated or replaced by fallback", () => {
    const model = makeModel({ context: 1_048_576, output: 32_000 })
    const cfg = baseCfg()
    const budget = usable({ cfg, model })
    expect(budget).toBe(1_048_576 - 20_000)
    expect(budget).toBeGreaterThan(1_000_000)
  })

  test("Test 7 — missing output limit falls back gracefully", () => {
    const model = makeModel({ context: 200_000, output: 0 })
    const cfg = baseCfg()
    // Unknown output -> requested defaults to OUTPUT_TOKEN_MAX (32k), reserved 20k.
    const budget = usable({ cfg, model })
    expect(budget).toBe(180_000)
    expect(isOverflow({ cfg, model, tokens: tokensFor(10_000) })).toBe(false)
  })

  test("Test 8 — missing context limit never silently becomes 16k", () => {
    const model = makeModel({ context: 0, output: 32_000 })
    const cfg = baseCfg()
    expect(usable({ cfg, model })).toBe(0)
    // Unknown capacity disables auto-compaction rather than compacting immediately.
    expect(isOverflow({ cfg, model, tokens: tokensFor(16_600) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(1_000_000) })).toBe(false)
  })

  test("Test 9 — malformed provider metadata is safe", () => {
    expect(normalizeLimits({ context: 0, output: 0 })).toEqual({ context: 0, input: undefined, output: 0 })
    expect(normalizeLimits({ context: -5, output: 10 }).context).toBe(0)
    expect(normalizeLimits({ context: NaN, output: 10 }).context).toBe(0)
    expect(normalizeLimits({ context: undefined, output: undefined }).context).toBe(0)
    expect(normalizeLimits({ context: null as any, output: null as any }).context).toBe(0)
    expect(normalizeLimits({ context: "1048576" as any, output: 10 }).context).toBe(0)
    // output > context is preserved on the type but budgeting must not zero the budget.
    const malformed = makeModel({ context: 100_000, output: 500_000 })
    const cfg = baseCfg()
    const budget = usable({ cfg, model: malformed })
    // Requested = min(500k, 32k) = 32k; reserved = 20k; budget = 80k (not 0).
    expect(budget).toBe(80_000)
    expect(isOverflow({ cfg, model: malformed, tokens: tokensFor(16_600) })).toBe(false)
  })

  test("Test 10 — post-compaction retention explains ~16k (WHEN vs HOW MUCH)", () => {
    // WHEN: threshold for Space Bunny is ~1M.
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const threshold = usable({ cfg, model })
    expect(threshold).toBeGreaterThan(900_000)
    // HOW MUCH: retained tail after compaction is capped at 15k by design.
    // preserveRecentBudget = min(15k, max(2k, floor(usable*0.25))) = 15k for large models.
    const retained = Math.min(15_000, Math.max(2_000, Math.floor(threshold * 0.25)))
    expect(retained).toBe(15_000)
    // Summary (~1-2k) + 15k tail ≈ 16-17k post-compaction total — valid, not a 16k limit.
    const postCompactionTotal = retained + 1_600
    expect(postCompactionTotal).toBeGreaterThan(15_000)
    expect(postCompactionTotal).toBeLessThan(20_000)
    // And that post-compaction total must NOT immediately re-trigger compaction.
    expect(shouldCompact({ usedTokens: postCompactionTotal, budget: threshold })).toBe(false)
  })

  test("Test 11 — repeated compaction does not loop", () => {
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const threshold = usable({ cfg, model })
    const afterFirstCompaction = 16_600 // summary + ~15k tail
    expect(isOverflow({ cfg, model, tokens: tokensFor(afterFirstCompaction) })).toBe(false)
    // Subsequent turns grow gradually and only compact at the real threshold.
    expect(isOverflow({ cfg, model, tokens: tokensFor(afterFirstCompaction + 5_000) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(threshold) })).toBe(true)
  })

  test("Test 12 — provider metadata precedence preserved through normalization", () => {
    // Simulate merge order: built-in -> provider override -> user override -> fallback.
    // Normalization must preserve the merged winner, not replace it.
    const builtin = { context: 1_048_576, output: 524_288, input: undefined }
    const providerOverride = { context: 1_048_576, output: 524_288, input: undefined }
    const userOverride = { context: 500_000, output: 50_000, input: undefined }
    // User override wins when present.
    const mergedUserWins = { ...builtin, ...providerOverride, ...userOverride }
    expect(normalizeLimits(mergedUserWins)).toEqual({ context: 500_000, input: undefined, output: 50_000 })
    // Without user override, provider value survives.
    const mergedProviderWins = { ...builtin, ...providerOverride }
    expect(normalizeLimits(mergedProviderWins)).toEqual({ context: 1_048_576, input: undefined, output: 524_288 })
    // Missing everything yields disabled (0), never a silent 16k fallback.
    expect(normalizeLimits({})).toEqual({ context: 0, input: undefined, output: 0 })
  })

  test("Test 13 — output reservation separates theoretical max from requested", () => {
    // 1M context, 512k theoretical max: old code subtracted the full capped
    // max (32k); new code reserves min(20k, requested) = 20k consistently.
    const requested = getRequestedOutputTokens({ outputCapability: 524_288, outputTokenMax: undefined })
    expect(requested).toBe(32_000)
    expect(getReservedOutputTokens({ requestedOutputTokens: requested })).toBe(20_000)
    // Even with a huge experimental flag, reservation stays bounded.
    const hugeRequested = getRequestedOutputTokens({ outputCapability: 524_288, outputTokenMax: 524_288 })
    expect(hugeRequested).toBe(524_288)
    expect(getReservedOutputTokens({ requestedOutputTokens: hugeRequested })).toBe(20_000)
    // Budget uses the bounded reservation, not the theoretical max.
    const budget = getCompactionBudget({
      contextLimit: 1_048_576,
      maxOutputTokens: hugeRequested,
    })
    // Old (buggy): 1M - 524k = 524k. New: 1M - 20k = ~1M.
    expect(budget.budget).toBe(1_048_576 - 20_000)
    expect(budget.budget).toBeGreaterThan(1_000_000)
  })

  test("getCompactionBudget / shouldCompact are pure and independent", () => {
    const budget = getCompactionBudget({ contextLimit: 100_000, maxOutputTokens: 32_000 })
    expect(budget.capacity).toBe(100_000)
    expect(budget.reserved).toBe(20_000)
    expect(budget.budget).toBe(80_000)
    expect(shouldCompact({ usedTokens: 79_999, budget: budget.budget })).toBe(false)
    expect(shouldCompact({ usedTokens: 80_000, budget: budget.budget })).toBe(true)
    // input cap uses min(context, input).
    const withInput = getCompactionBudget({ contextLimit: 400_000, inputLimit: 272_000, maxOutputTokens: 32_000 })
    expect(withInput.capacity).toBe(272_000)
    expect(withInput.budget).toBe(252_000)
    // input larger than context cannot inflate beyond context.
    const inflated = getCompactionBudget({ contextLimit: 100_000, inputLimit: 500_000, maxOutputTokens: 32_000 })
    expect(inflated.capacity).toBe(100_000)
  })

  test("token accounting includes reasoning and cache, prefers max(total, sum)", () => {
    const base = { input: 10_000, output: 5_000, reasoning: 3_000, cache: { read: 2_000, write: 1_000 } }
    expect(getUsedTokens({ ...base, total: 0 } as any)).toBe(21_000)
    // total already includes everything -> use total.
    expect(getUsedTokens({ ...base, total: 21_000 } as any)).toBe(21_000)
    // total stale (excludes reasoning) -> use sum to avoid undercount.
    expect(getUsedTokens({ ...base, total: 18_000 } as any)).toBe(21_000)
  })

  test("diagnostics expose full compaction decision", () => {
    const model = makeModel(SPACE_BUNNY)
    const limits = normalizeLimits(model.limit)
    const requested = getRequestedOutputTokens({ outputCapability: limits.output, outputTokenMax: undefined })
    const budget = getCompactionBudget({ contextLimit: limits.context, inputLimit: limits.input, maxOutputTokens: requested })
    const check = describeCompactionCheck({ model, usedTokens: 16_621, budget, compact: false, reason: "used<threshold" })
    expect(check.contextLimit).toBe(1_048_576)
    expect(check.outputCapability).toBe(524_288)
    expect(check.requestedOutput).toBe(32_000)
    expect(check.reserved).toBe(20_000)
    expect(check.used).toBe(16_621)
    expect(check.threshold).toBeGreaterThan(900_000)
    const text = formatCompactionCheck(check)
    expect(text).toContain("space-bunny")
    expect(text).toContain("context=1048576")
    expect(text).toContain("compact=false")
  })

  test("integration — session grows to 16.6k (no compact), compacts only at threshold, retains ~15k", () => {
    const model = makeModel(SPACE_BUNNY)
    const cfg = baseCfg()
    const threshold = usable({ cfg, model })
    // Accumulate: 16.6k must NOT compact.
    let used = 0
    for (const chunk of [5_000, 5_000, 6_600]) {
      used += chunk
      expect(isOverflow({ cfg, model, tokens: tokensFor(used) })).toBe(false)
    }
    expect(used).toBe(16_600)
    // Continue adding until legitimate threshold.
    expect(isOverflow({ cfg, model, tokens: tokensFor(threshold - 1) })).toBe(false)
    expect(isOverflow({ cfg, model, tokens: tokensFor(threshold) })).toBe(true)
    // After compaction: summary + ~15k retained, conversation continues normally.
    const retained = Math.min(15_000, Math.max(2_000, Math.floor(threshold * 0.25)))
    const postCompaction = retained + 1_600
    expect(isOverflow({ cfg, model, tokens: tokensFor(postCompaction) })).toBe(false)
  })

  test("old unbounded subtraction would waste half the window (documents fix)", () => {
    // Simulate OLD formula: context - requested (unbounded) vs NEW: context - bounded.
    const context = 1_048_576
    const hugeRequested = 524_288
    const oldBudget = Math.max(0, context - hugeRequested)
    const newBudget = getCompactionBudget({ contextLimit: context, maxOutputTokens: hugeRequested }).budget
    expect(oldBudget).toBe(524_288)
    expect(newBudget).toBe(1_028_576)
    // At 600k used, old would (incorrectly) compact, new correctly does not.
    expect(oldBudget <= 600_000).toBe(true)
    expect(shouldCompact({ usedTokens: 600_000, budget: newBudget })).toBe(false)
  })

  test("COMPACTION_BUFFER and OUTPUT_TOKEN_MAX sanity", () => {
    expect(COMPACTION_BUFFER).toBe(20_000)
    expect(ProviderTransform.OUTPUT_TOKEN_MAX).toBe(32_000)
  })
})
