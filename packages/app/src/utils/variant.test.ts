import { describe, expect, test } from "bun:test"

/**
 * Tests for model variant (thinking effort) cycling logic.
 *
 * The variant system allows users to cycle through different "thinking effort"
 * levels for models that support it (e.g., low, medium, high).
 */

type VariantState = {
  current: string | undefined
  variants: string[]
}

/**
 * Pure function that implements the variant cycling logic.
 * Extracted from local.tsx for testability.
 */
function cycleVariant(state: VariantState): string | undefined {
  const { current, variants } = state

  if (variants.length === 0) return current

  if (!current) {
    return variants[0]
  }

  const index = variants.indexOf(current)
  if (index === -1 || index === variants.length - 1) {
    return undefined // Reset to default
  }

  return variants[index + 1]
}

describe("variant cycling", () => {
  test("returns undefined when no variants available", () => {
    expect(cycleVariant({ current: undefined, variants: [] })).toBe(undefined)
    expect(cycleVariant({ current: "low", variants: [] })).toBe("low")
  })

  test("starts with first variant when current is undefined", () => {
    expect(cycleVariant({ current: undefined, variants: ["low", "medium", "high"] })).toBe("low")
  })

  test("cycles through variants in order", () => {
    const variants = ["low", "medium", "high"]

    expect(cycleVariant({ current: "low", variants })).toBe("medium")
    expect(cycleVariant({ current: "medium", variants })).toBe("high")
  })

  test("resets to undefined after last variant", () => {
    const variants = ["low", "medium", "high"]

    expect(cycleVariant({ current: "high", variants })).toBe(undefined)
  })

  test("resets to undefined when current is not in variants list", () => {
    const variants = ["low", "medium", "high"]

    expect(cycleVariant({ current: "unknown", variants })).toBe(undefined)
  })

  test("handles single variant", () => {
    const variants = ["low"]

    expect(cycleVariant({ current: undefined, variants })).toBe("low")
    expect(cycleVariant({ current: "low", variants })).toBe(undefined)
  })

  test("full cycle returns to start", () => {
    const variants = ["low", "medium", "high"]
    let current: string | undefined = undefined

    // Cycle through all variants and back to default
    current = cycleVariant({ current, variants }) // -> low
    expect(current).toBe("low")

    current = cycleVariant({ current, variants }) // -> medium
    expect(current).toBe("medium")

    current = cycleVariant({ current, variants }) // -> high
    expect(current).toBe("high")

    current = cycleVariant({ current, variants }) // -> undefined (default)
    expect(current).toBe(undefined)

    current = cycleVariant({ current, variants }) // -> low (restart)
    expect(current).toBe("low")
  })
})

describe("variant key generation", () => {
  /**
   * Generates a unique key for storing variant preference per model.
   */
  function getVariantKey(providerId: string, modelId: string): string {
    return `${providerId}/${modelId}`
  }

  test("creates correct key format", () => {
    expect(getVariantKey("anthropic", "claude-3-5-sonnet")).toBe("anthropic/claude-3-5-sonnet")
    expect(getVariantKey("openai", "o1")).toBe("openai/o1")
  })

  test("handles special characters in IDs", () => {
    expect(getVariantKey("custom-provider", "model-v2.1")).toBe("custom-provider/model-v2.1")
  })
})

describe("variant list extraction", () => {
  type Model = {
    id: string
    variants?: Record<string, unknown>
  }

  function getVariantList(model: Model | undefined): string[] {
    if (!model) return []
    if (!model.variants) return []
    return Object.keys(model.variants)
  }

  test("returns empty array for undefined model", () => {
    expect(getVariantList(undefined)).toEqual([])
  })

  test("returns empty array for model without variants", () => {
    expect(getVariantList({ id: "test" })).toEqual([])
    expect(getVariantList({ id: "test", variants: undefined })).toEqual([])
  })

  test("returns variant keys for model with variants", () => {
    const model = {
      id: "o1",
      variants: {
        low: { maxTokens: 1000 },
        medium: { maxTokens: 5000 },
        high: { maxTokens: 10000 },
      },
    }
    expect(getVariantList(model)).toEqual(["low", "medium", "high"])
  })

  test("returns empty array for empty variants object", () => {
    expect(getVariantList({ id: "test", variants: {} })).toEqual([])
  })
})
