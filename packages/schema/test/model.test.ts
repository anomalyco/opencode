import { describe, expect, test } from "bun:test"
import { Model } from "../src/model.js"

describe("Model.Ref", () => {
  test("parses model references with optional variants", () => {
    const variant = Model.Ref.parse("openrouter/openai/gpt-5#high")
    expect(String(variant.providerID)).toBe("openrouter")
    expect(String(variant.id)).toBe("openai/gpt-5")
    expect(String(variant.variant)).toBe("high")

    const standard = Model.Ref.parse("anthropic/claude-sonnet")
    expect(String(standard.providerID)).toBe("anthropic")
    expect(String(standard.id)).toBe("claude-sonnet")
    expect(standard.variant).toBeUndefined()
  })

  test("rejects malformed model references", () => {
    expect(() => Model.Ref.parse("gpt-5")).toThrow()
    expect(() => Model.Ref.parse("openai/gpt-5#")).toThrow()
    expect(() => Model.Ref.parse("openai/gpt-5#high#extra")).toThrow()
  })
})
