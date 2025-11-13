import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.maxOutputTokens", () => {
  test("returns standardLimit when modelLimit equals globalLimit", () => {
    const modelLimit = OUTPUT_TOKEN_MAX
    const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("returns globalLimit when modelLimit is greater", () => {
    const modelLimit = 100000
    const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("returns modelLimit when globalLimit is greater", () => {
    const modelLimit = 16000
    const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(16000)
  })

  test("uses globalLimit when modelLimit is 0", () => {
    const modelLimit = 0
    const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("uses globalLimit as fallback when modelLimit is falsy", () => {
    const modelLimit = 0
    const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  describe("anthropic provider with thinking enabled", () => {
    test("returns standardLimit when budgetTokens + standardLimit <= modelCap", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelCap - budgetTokens when budgetTokens + standardLimit > modelCap", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 25000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(25000) // 50000 - 25000
    })

    test("returns standardLimit when budgetTokens is 0", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 0,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns standardLimit when thinking type is not enabled", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "disabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns standardLimit when budgetTokens is not a number", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: "not-a-number",
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns standardLimit when thinking is undefined", () => {
      const modelLimit = 50000
      const result = ProviderTransform.maxOutputTokens("anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns standardLimit when options is empty", () => {
      const modelLimit = 50000
      const result = ProviderTransform.maxOutputTokens("anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles edge case where budgetTokens equals modelCap", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 50000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(0) // 50000 - 50000
    })

    test("handles edge case where budgetTokens exceeds modelCap", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 60000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(-10000) // 50000 - 60000 (negative)
    })

    test("prefers 32k text when possible with low budgetTokens", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 5000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // 5000 + 32000 = 37000 <= 100000
    })

    test("reduces text tokens when budgetTokens doesn't allow 32k text", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 30000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(20000) // 50000 - 30000
    })

    test("handles negative budgetTokens", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: -5000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // negative is treated as 0 (not > 0)
    })
  })

  describe("non-anthropic providers", () => {
    test("ignores thinking options for openai", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("openai", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("ignores thinking options for google", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("google", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("ignores thinking options for bedrock", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("bedrock", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })
  })

  describe("real-world usage scenarios from prompt.ts", () => {
    test("typical openai usage without thinking", () => {
      // Simulates line 299-304 in prompt.ts
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })

    test("anthropic claude with extended thinking enabled", () => {
      // Simulates anthropic with thinking budget
      const modelLimit = 200000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 20000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // 20000 + 32000 = 52000 <= 200000
    })

    test("anthropic claude with large thinking budget", () => {
      const modelLimit = 200000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 100000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // 100000 + 32000 = 132000 <= 200000, so returns standardLimit
    })

    test("anthropic claude with thinking budget that prevents 32k text", () => {
      const modelLimit = 200000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 170000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(30000) // 170000 + 32000 = 202000 > 200000, so returns 200000 - 170000
    })

    test("model with small output limit", () => {
      const modelLimit = 4096
      const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(4096)
    })

    test("model with very large output limit", () => {
      const modelLimit = 200000
      const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })
  })

  describe("edge cases and boundary conditions", () => {
    test("handles undefined options parameter", () => {
      const modelLimit = 50000
      const result = ProviderTransform.maxOutputTokens("anthropic", undefined as any, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles null options parameter", () => {
      const modelLimit = 50000
      const result = ProviderTransform.maxOutputTokens("anthropic", null as any, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles options with nested undefined thinking", () => {
      const modelLimit = 50000
      const options = {
        thinking: undefined,
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles options with null thinking", () => {
      const modelLimit = 50000
      const options = {
        thinking: null as any,
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles very large globalLimit", () => {
      const modelLimit = 10000
      const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, 1000000)
      expect(result).toBe(10000)
    })

    test("handles equal modelLimit and globalLimit", () => {
      const modelLimit = 50000
      const result = ProviderTransform.maxOutputTokens("openai", {}, modelLimit, 50000)
      expect(result).toBe(50000)
    })

    test("handles anthropic with budgetTokens as string", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: "10000",
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // string is not a number, so treated as 0
    })

    test("handles anthropic with budgetTokens as float", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000.5,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles anthropic with very small modelCap", () => {
      const modelLimit = 500
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 100,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(400) // 500 - 100
    })

    test("handles anthropic where budgetTokens exactly equals modelCap minus standardLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 18000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // 18000 + 32000 = 50000, exactly at boundary
    })

    test("handles anthropic where budgetTokens just exceeds modelCap minus standardLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 18001,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(31999) // 50000 - 18001
    })

    test("handles provider ID case variations", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      // Should not trigger anthropic-specific logic
      const result = ProviderTransform.maxOutputTokens("Anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("handles thinking type with different enabled values", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "ENABLED", // uppercase
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX) // not exactly "enabled", so disabled
    })
  })
})
