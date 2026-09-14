import { describe, expect, it } from "bun:test"
import { costBreakdown, type CostSample } from "./cost"

const s = (t: number, cost: number, tokens: number, provider = "anthropic", model = "sonnet"): CostSample => ({
  t,
  cost,
  tokens,
  provider,
  model,
})

describe("costBreakdown", () => {
  it("totals everything and windows by (now-secs, now]", () => {
    const out = costBreakdown([s(100, 1, 1000), s(3500, 2, 600), s(3600, 3, 1200)], 3600, 3600)
    expect(out.total).toEqual({ cost: 6, tokens: 2800 })
    // t=100 is inside (0, 3600]; nothing is excluded
    expect(out.window.cost).toBe(6)
    const narrow = costBreakdown([s(100, 1, 1000), s(3500, 2, 600), s(3600, 3, 1200)], 3600, 300)
    expect(narrow.window).toEqual({ cost: 5, tokens: 1800, costPerHour: 60, tokensPerMin: 360 })
  })

  it("groups by provider/model sorted by window cost then total cost", () => {
    const out = costBreakdown(
      [s(10, 5, 100, "openai", "gpt"), s(290, 1, 100, "anthropic", "sonnet"), s(295, 2, 50, "anthropic", "opus")],
      300,
      60,
    )
    expect(out.byModel.map((m) => `${m.provider}/${m.model}`)).toEqual(["anthropic/opus", "anthropic/sonnet", "openai/gpt"])
    expect(out.byModel[2]).toEqual({ provider: "openai", model: "gpt", cost: 5, tokens: 100, windowCost: 0, windowTokens: 0 })
  })

  it("ignores nonfinite and negative values", () => {
    const out = costBreakdown([s(10, Number.NaN, -5), s(20, 1, 10)], 30, 60)
    expect(out.total).toEqual({ cost: 1, tokens: 10 })
  })

  it("returns zeros for empty input", () => {
    const out = costBreakdown([], 100, 300)
    expect(out.total).toEqual({ cost: 0, tokens: 0 })
    expect(out.window).toEqual({ cost: 0, tokens: 0, costPerHour: 0, tokensPerMin: 0 })
    expect(out.byModel).toEqual([])
  })
})
