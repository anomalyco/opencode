import { describe, expect, test } from "bun:test"
import { usable, isOverflow } from "../../src/session/overflow"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Provider } from "@/provider/provider"

function makeModel(overrides: Partial<Provider.Model["limit"]> = {}): Provider.Model {
  return {
    id: "test-model",
    name: "Test Model",
    limit: {
      context: 1_000_000,
      output: 131_072,
      ...overrides,
    },
    attachment: {},
    reasoning: false,
    cost: { input: 0, output: 0 },
    temperature: { min: 0, max: 1 },
  } as Provider.Model
}

function makeCfg(compaction?: ConfigV1.Info["compaction"]): ConfigV1.Info {
  return { compaction } as ConfigV1.Info
}

describe("usable()", () => {
  test("returns 0 when context is 0", () => {
    const model = makeModel({ context: 0 })
    expect(usable({ cfg: makeCfg(), model })).toBe(0)
  })

  describe("branch A: model with limit.input", () => {
    test("subtracts default reserved from limit.input", () => {
      const model = makeModel({ input: 500_000 })
      const result = usable({ cfg: makeCfg(), model })
      // default reserved = min(20_000, maxOutputTokens)
      // maxOutputTokens = min(131_072, 32_000) = 32_000
      // reserved = min(20_000, 32_000) = 20_000
      expect(result).toBe(500_000 - 20_000)
    })

    test("subtracts explicit compaction.reserved from limit.input", () => {
      const model = makeModel({ input: 500_000 })
      const cfg = makeCfg({ reserved: 100_000 })
      const result = usable({ cfg, model })
      expect(result).toBe(500_000 - 100_000)
    })
  })

  describe("branch B: model without limit.input", () => {
    test("subtracts default reserved from context - maxOutputTokens", () => {
      const model = makeModel({ context: 1_000_000, output: 131_072 })
      const result = usable({ cfg: makeCfg(), model })
      // maxOutputTokens = min(131_072, 32_000) = 32_000
      // default reserved = min(20_000, 32_000) = 20_000
      expect(result).toBe(1_000_000 - 32_000 - 20_000)
    })

    test("subtracts explicit compaction.reserved from context - maxOutputTokens", () => {
      const model = makeModel({ context: 1_000_000, output: 131_072 })
      const cfg = makeCfg({ reserved: 648_928 })
      const result = usable({ cfg, model })
      // maxOutputTokens = min(131_072, 32_000) = 32_000
      expect(result).toBe(1_000_000 - 32_000 - 648_928)
    })

    test("clamps to 0 when reserved exceeds available space", () => {
      const model = makeModel({ context: 100_000, output: 131_072 })
      const cfg = makeCfg({ reserved: 200_000 })
      const result = usable({ cfg, model })
      expect(result).toBe(0)
    })
  })

  describe("outputTokenMax override", () => {
    test("uses outputTokenMax when provided", () => {
      const model = makeModel({ context: 1_000_000, output: 131_072 })
      const result = usable({ cfg: makeCfg(), model, outputTokenMax: 64_000 })
      // maxOutputTokens = min(131_072, 64_000) = 64_000
      // default reserved = min(20_000, 64_000) = 20_000
      expect(result).toBe(1_000_000 - 64_000 - 20_000)
    })
  })
})

describe("isOverflow()", () => {
  const zeroTokens = { total: 0, input: 0, output: 0, cache: { read: 0, write: 0 } }

  test("returns false when auto compaction is disabled", () => {
    const model = makeModel()
    const cfg = makeCfg({ auto: false })
    const tokens = { ...zeroTokens, total: 999_999 }
    expect(isOverflow({ cfg, tokens, model })).toBe(false)
  })

  test("returns false when context is 0", () => {
    const model = makeModel({ context: 0 })
    const tokens = { ...zeroTokens, total: 999_999 }
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  test("returns true when total tokens exceed usable", () => {
    const model = makeModel({ context: 100_000, output: 131_072 })
    // usable = 100_000 - 32_000 - 20_000 = 48_000
    const tokens = { ...zeroTokens, total: 48_001 }
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })

  test("returns false when total tokens below usable", () => {
    const model = makeModel({ context: 100_000, output: 131_072 })
    const tokens = { ...zeroTokens, total: 47_999 }
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  test("sums individual token fields when total is 0", () => {
    const model = makeModel({ context: 100_000, output: 131_072 })
    // usable = 48_000
    const tokens = { total: 0, input: 30_000, output: 10_000, cache: { read: 5_000, write: 4_000 } }
    // sum = 49_000 > 48_000
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })
})
