import { describe, expect, test } from "bun:test"
import { ModelAccess } from "../src/model-access"

describe("ModelAccess", () => {
  test("maps Claude and GPT model IDs to their reporting providers", () => {
    expect(ModelAccess.provider("claude-opus-4-1")).toBe("anthropic")
    expect(ModelAccess.provider("gpt-5.1-codex")).toBe("openai")
    expect(ModelAccess.provider("gemini-2.5-pro")).toBeUndefined()
  })

  test("blocks only models from a blocked provider", () => {
    expect(ModelAccess.blocked("claude-sonnet-4", ["anthropic"])).toBe(true)
    expect(ModelAccess.blocked("gpt-5", ["anthropic"])).toBe(false)
    expect(ModelAccess.blocked("claude-sonnet-4", null)).toBe(false)
  })

  test("provides names for the API error", () => {
    expect(ModelAccess.label("anthropic")).toEqual({ provider: "Anthropic", models: "Claude" })
    expect(ModelAccess.label("openai")).toEqual({ provider: "OpenAI", models: "GPT" })
  })
})
