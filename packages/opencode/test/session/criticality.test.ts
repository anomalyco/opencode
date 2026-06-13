import { describe, expect, test } from "bun:test"
import { computeKEff, computeDMax, decide, DEFAULTS, readSettings } from "@/session/criticality"

describe("config validation", () => {
  test("rejects epsilon=0 (division by zero protection)", () => {
    const cfg = readSettings({ criticality: { epsilon: 0 } })
    expect(cfg.epsilon).toBe(DEFAULTS.epsilon)
  })

  test("rejects NaN and Infinity in numeric fields", () => {
    expect(readSettings({ criticality: { k_upper: Number.NaN } }).kUpper).toBe(DEFAULTS.kUpper)
    expect(readSettings({ criticality: { k_upper: Number.POSITIVE_INFINITY } }).kUpper).toBe(DEFAULTS.kUpper)
    expect(readSettings({ criticality: { n_max: -5 } }).nMax).toBe(DEFAULTS.nMax)
  })

  test("rejects epsilon >= 1", () => {
    expect(readSettings({ criticality: { epsilon: 1.5 } }).epsilon).toBe(DEFAULTS.epsilon)
  })

  test("accepts valid epsilon in [0, 1)", () => {
    const cfg = readSettings({ criticality: { epsilon: 0.05 } })
    expect(cfg.epsilon).toBe(0.05)
  })

  test("defaults to monitor mode on invalid mode", () => {
    expect(readSettings({ criticality: { mode: "invalid" } }).mode).toBe("monitor")
  })

  test("rejects negative budgets", () => {
    expect(readSettings({ criticality: { budget_usd: -10 } }).budgetUsd).toBeUndefined()
  })
})

describe("ACE math", () => {
  test("k_eff regimes (paper eq. 2)", () => {
    const eps = 0.1
    // subcritical: absorption dominates spawning -> k_eff < 1
    expect(computeKEff(0.5, 1.0, eps)).toBeLessThan(1)
    // near-critical: spawning ~ absorption -> k_eff ~ 1
    expect(computeKEff(1.0, 0.9, eps)).toBeCloseTo(1, 1)
    // supercritical: spawning dominates -> k_eff > 1
    expect(computeKEff(2.0, 0.1, eps)).toBeGreaterThan(1)
  })

  test("k_eff never divides by zero in empty windows", () => {
    expect(Number.isFinite(computeKEff(0, 0, 0.1))).toBe(true)
    expect(computeKEff(0, 0, 0.1)).toBe(0)
  })

  test("D_max is finite and decreasing in branching for supercritical cascades", () => {
    const eps = 0.1
    const slow = computeDMax(64, 1, 1.4, eps) // nu*f ~ 1.5
    const fast = computeDMax(64, 1, 4.0, eps) // nu*f ~ 4.1
    expect(Number.isFinite(slow)).toBe(true)
    expect(Number.isFinite(fast)).toBe(true)
    // faster branching reaches the population ceiling at a shallower depth
    expect(fast).toBeLessThan(slow)
  })

  test("D_max is infinite for subcritical branching (no bound needed)", () => {
    // nu*f + epsilon <= 1 means the cascade dies out on its own
    expect(computeDMax(64, 1, 0.5, 0.1)).toBe(Number.POSITIVE_INFINITY)
    expect(computeDMax(64, 1, 0.0, 0.1)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("circuit-breaker decision (paper §5.3)", () => {
  const base = { kUpper: 1.5, dMax: 5 }

  test("monitor mode never blocks", () => {
    expect(
      decide({ mode: "monitor", depth: 100, dMax: 1, kEff: 99, kUpper: 1.5 }).decision,
    ).toBe("spawn")
  })

  test("gate rejects on depth limit", () => {
    expect(
      decide({ mode: "gate", depth: 5, kEff: 0.1, ...base }).decision,
    ).toBe("reject_depth")
  })

  test("gate rejects on supercritical k_eff", () => {
    expect(
      decide({ mode: "gate", depth: 0, kEff: 2.0, ...base }).decision,
    ).toBe("reject_supercritical")
  })

  test("gate rejects on budget", () => {
    expect(
      decide({
        mode: "gate",
        depth: 0,
        kEff: 0.1,
        kUpper: 1.5,
        dMax: 5,
        budgetUsd: 1.0,
        cascadeCost: 0.9,
        costHat: 0.5,
      }).decision,
    ).toBe("reject_budget")
  })

  test("gate spawns when within all bounds", () => {
    expect(
      decide({ mode: "gate", depth: 1, kEff: 0.8, ...base }).decision,
    ).toBe("spawn")
  })

  test("depth limit is checked before k_eff", () => {
    // when both depth and k_eff are violated, depth wins (matches pseudocode order)
    expect(
      decide({ mode: "gate", depth: 5, kEff: 99, ...base }).decision,
    ).toBe("reject_depth")
  })
})
