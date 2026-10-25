import { describe, expect, test } from "bun:test"
import { LIMIT } from "../../../src/cli/cmd/run/best-of"
import { parseModels } from "../../../src/cli/cmd/run/arena"

describe("cli.run.arena", () => {
  test("parseModels splits and trims provider/model entries", () => {
    const result = parseModels(" anthropic/claude-sonnet-4 , openai/gpt-5 ")
    expect(result).toEqual([
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      { providerID: "openai", modelID: "gpt-5" },
    ])
  })

  test("parseModels keeps duplicates so a model can race itself", () => {
    const result = parseModels("anthropic/claude-sonnet-4,anthropic/claude-sonnet-4")
    expect(result).toEqual([
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
    ])
  })

  test("parseModels keeps nested model paths intact", () => {
    const result = parseModels("openrouter/openai/gpt-5-chat,anthropic/claude-sonnet-4")
    expect(result).toEqual([
      { providerID: "openrouter", modelID: "openai/gpt-5-chat" },
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
    ])
  })

  test("parseModels rejects fewer than two entries", () => {
    expect(typeof parseModels("anthropic/claude-sonnet-4")).toBe("string")
    expect(typeof parseModels("")).toBe("string")
  })

  test("parseModels rejects entries without a provider/model shape", () => {
    expect(typeof parseModels("anthropic/claude,gpt-5")).toBe("string")
    expect(typeof parseModels("anthropic/claude,/gpt-5")).toBe("string")
    expect(typeof parseModels("anthropic/claude,openai/")).toBe("string")
  })

  test("parseModels enforces the entry limit", () => {
    const many = Array.from({ length: LIMIT + 1 }, (_, i) => `p/m${i}`).join(",")
    expect(typeof parseModels(many)).toBe("string")
    const max = Array.from({ length: LIMIT }, () => "p/m").join(",")
    expect(Array.isArray(parseModels(max))).toBe(true)
  })
})
