import { describe, expect, test } from "bun:test"
import { effectiveThreshold } from "../../src/core/threshold"
import { DEFAULT_CONFIG } from "../../src/core/config"

const cfg = { ...DEFAULT_CONFIG }

describe("effectiveThreshold", () => {
  test("50% of context limit", () => {
    const r = effectiveThreshold({ cfg, modelLimit: 300000 })
    expect(r).toEqual({ value: 150000, source: "computed" })
  })

  test("200k cap", () => {
    expect(effectiveThreshold({ cfg, modelLimit: 1000000 })).toEqual({ value: 200000, source: "computed" })
  })

  test("20k minimum", () => {
    expect(effectiveThreshold({ cfg, modelLimit: 30000 })).toEqual({ value: 20000, source: "computed" })
  })

  test("floor rounding", () => {
    expect(effectiveThreshold({ cfg, modelLimit: 250001 })).toEqual({ value: Math.min(125000, 200000), source: "computed" })
  })

  test("session override wins", () => {
    expect(effectiveThreshold({ cfg, sessionOverride: 50000, modelLimit: 1000000 })).toEqual({
      value: 50000,
      source: "session",
    })
  })

  test("explicit config override beats computed", () => {
    expect(effectiveThreshold({ cfg: { ...cfg, thresholdTokens: 80000 }, modelLimit: 1000000 })).toEqual({
      value: 80000,
      source: "config",
    })
  })

  test("missing model limit falls back to 100k", () => {
    expect(effectiveThreshold({ cfg })).toEqual({ value: 100000, source: "fallback" })
  })

  test("zero model limit falls back", () => {
    expect(effectiveThreshold({ cfg, modelLimit: 0 })).toEqual({ value: 100000, source: "fallback" })
  })

  test("negative model limit falls back", () => {
    expect(effectiveThreshold({ cfg, modelLimit: -5 })).toEqual({ value: 100000, source: "fallback" })
  })

  test("session override beats config override", () => {
    expect(effectiveThreshold({ cfg: { ...cfg, thresholdTokens: 80000 }, sessionOverride: 50000, modelLimit: 1000000 })).toEqual({
      value: 50000,
      source: "session",
    })
  })
})
