import { describe, expect, it } from "bun:test"
import { listTiers, selectTier } from "../../src/provider/simplicio1"

describe("simplicio1.selectTier", () => {
  it("respects an explicit override", () => {
    const tier = selectTier({ override: "1.5b", ramGb: 64, hfTokenPresent: true, hfBudgetRemainingUsd: 4 })
    expect(tier.id).toBe("1.5b")
  })

  it("ignores unknown override and falls back to auto", () => {
    const tier = selectTier({ override: "999b", ramGb: 32, hfTokenPresent: false })
    expect(tier.id).toBe("14b")
  })

  it("prefers DeepSeek when HF budget is present", () => {
    const tier = selectTier({ ramGb: 16, hfTokenPresent: true, hfBudgetRemainingUsd: 4.99 })
    expect(tier.id).toBe("deepseek-v4-pro")
  })

  it("skips DeepSeek when budget is too low", () => {
    const tier = selectTier({ ramGb: 16, hfTokenPresent: true, hfBudgetRemainingUsd: 0.05 })
    expect(tier.id).toBe("14b")
  })

  it("picks 7b on an 8 GB box", () => {
    expect(selectTier({ ramGb: 8 }).id).toBe("7b")
  })

  it("picks 3b on a 4 GB box", () => {
    expect(selectTier({ ramGb: 4 }).id).toBe("3b")
  })

  it("picks 1.5b on a 2 GB box", () => {
    expect(selectTier({ ramGb: 2 }).id).toBe("1.5b")
  })

  it("falls back to smallest tier on tiny machines", () => {
    expect(selectTier({ ramGb: 0.5 }).id).toBe("1.5b")
  })

  it("exposes the full tier list", () => {
    expect(listTiers().length).toBe(5)
  })
})
