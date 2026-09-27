import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Schema } from "effect"
import { preserveRecentBudget } from "../../src/session/compaction"
import { compactionDebug, getCompactionBudget, isOverflow, normalizeLimits, shouldCompact, usable } from "../../src/session/overflow"
import type { Provider } from "../../src/provider/provider"

const cfg = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info

function model(limit: { context: number; output: number; input?: number }) {
  return { id: "space-bunny", providerID: "test", limit } as Provider.Model
}

function tokens(total: number) {
  return { input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

const SPACE_BUNNY = { context: 1_048_576, output: 524_288 }

describe("compaction budget", () => {
  test("does not compact a 1M model at 16.6k", () => {
    expect(usable({ cfg, model: model(SPACE_BUNNY) })).toBe(1_048_576 - 20_000)
    expect(isOverflow({ cfg, model: model(SPACE_BUNNY), tokens: tokens(16_600) })).toBe(false)
  })

  test("compacts only once the budget is reached", () => {
    const budget = usable({ cfg, model: model(SPACE_BUNNY) })
    expect(isOverflow({ cfg, model: model(SPACE_BUNNY), tokens: tokens(budget - 1) })).toBe(false)
    expect(isOverflow({ cfg, model: model(SPACE_BUNNY), tokens: tokens(budget) })).toBe(true)
  })

  test("scales across context sizes", () => {
    expect(usable({ cfg, model: model({ context: 32_000, output: 8_000 }) })).toBe(24_000)
    expect(usable({ cfg, model: model({ context: 128_000, output: 32_000 }) })).toBe(108_000)
    expect(usable({ cfg, model: model({ context: 200_000, output: 0 }) })).toBe(180_000)
  })

  test("reserves a bounded window instead of the theoretical output maximum", () => {
    // 512k capability must not reserve 512k of a 1M window.
    const budget = getCompactionBudget({ contextLimit: 1_048_576, maxOutputTokens: 524_288 })
    expect(budget.requestedOutput).toBe(524_288)
    expect(budget.reserved).toBe(20_000)
    expect(shouldCompact({ usedTokens: 600_000, budget: budget.budget })).toBe(false)
  })

  test("honors a configured reservation", () => {
    const configured = { ...cfg, compaction: { reserved: 64_000 } }
    expect(usable({ cfg: configured, model: model(SPACE_BUNNY) })).toBe(1_048_576 - 64_000)
  })

  test("treats malformed metadata as unknown rather than small", () => {
    expect(normalizeLimits({ context: 0, output: 0 })).toEqual({ context: 0, input: undefined, output: 0 })
    expect(normalizeLimits({ context: -5, output: 10 }).context).toBe(0)
    expect(normalizeLimits({ context: NaN, output: 10 }).context).toBe(0)
    expect(normalizeLimits({ context: Infinity, output: 10 }).context).toBe(0)
    expect(normalizeLimits({ context: undefined, output: undefined }).context).toBe(0)
    expect(normalizeLimits({ context: null as unknown, output: null as unknown }).context).toBe(0)
    expect(normalizeLimits({ context: "1048576" as unknown, output: 10 }).context).toBe(0)
  })

  test("never compacts when capacity is unknown", () => {
    const unknown = model({ context: 0, output: 32_000 })
    expect(usable({ cfg, model: unknown })).toBe(0)
    expect(isOverflow({ cfg, model: unknown, tokens: tokens(1_000_000) })).toBe(false)
  })

  test("keeps a budget when output metadata exceeds the window", () => {
    const malformed = model({ context: 100_000, output: 500_000 })
    expect(usable({ cfg, model: malformed })).toBe(80_000)
    expect(isOverflow({ cfg, model: malformed, tokens: tokens(16_600) })).toBe(false)
  })

  test("does not let an input cap above the window inflate the budget", () => {
    expect(getCompactionBudget({ contextLimit: 100_000, inputLimit: 500_000, maxOutputTokens: 32_000 }).capacity).toBe(
      100_000,
    )
    expect(getCompactionBudget({ contextLimit: 400_000, inputLimit: 272_000, maxOutputTokens: 32_000 }).budget).toBe(
      252_000,
    )
  })

  test("counts reasoning and cache tokens", () => {
    const target = model({ context: 32_000, output: 8_000 })
    const usage = { input: 15_000, output: 5_000, cache: { read: 2_000, write: 1_000 } }
    // 23k without reasoning stays under the 24k budget; counting reasoning crosses it.
    expect(isOverflow({ cfg, model: target, tokens: { ...usage, reasoning: 0, total: 0 } })).toBe(false)
    expect(isOverflow({ cfg, model: target, tokens: { ...usage, reasoning: 3_000, total: 0 } })).toBe(true)
  })

  test("retained context after compaction does not re-trigger compaction", () => {
    const target = model(SPACE_BUNNY)
    const afterCompaction = preserveRecentBudget({ cfg, model: target })
    expect(afterCompaction).toBe(15_000)
    expect(isOverflow({ cfg, model: target, tokens: tokens(afterCompaction) })).toBe(false)
  })

  test("retention size is independent of the compaction threshold", () => {
    // A ~16k reading after compaction reflects retention, not a 16k context window.
    expect(preserveRecentBudget({ cfg, model: model({ context: 32_000, output: 8_000 }) })).toBe(6_000)
    expect(preserveRecentBudget({ cfg, model: model(SPACE_BUNNY) })).toBe(15_000)
    expect(usable({ cfg, model: model(SPACE_BUNNY) })).toBeGreaterThan(15_000 * 60)
  })

  test("compaction can be disabled by config", () => {
    const disabled = { ...cfg, compaction: { auto: false } }
    const budget = usable({ cfg: disabled, model: model(SPACE_BUNNY) })
    expect(isOverflow({ cfg: disabled, model: model(SPACE_BUNNY), tokens: tokens(budget) })).toBe(false)
  })

  test("debug line reports the decision without prompt content", () => {
    const line = compactionDebug({
      cfg,
      model: model(SPACE_BUNNY),
      tokens: tokens(16_621),
      compact: false,
    })
    expect(line).toContain("test/space-bunny")
    expect(line).toContain("context=1048576")
    expect(line).toContain("outputMax=524288")
    expect(line).toContain("reserved=20000")
    expect(line).toContain("used=16621")
    expect(line).toContain("compact=false")
  })
})
