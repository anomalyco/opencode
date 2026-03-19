import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import type { Provider } from "../../src/provider/provider"

function makeModel(overrides: Partial<Provider.Model> & { api: Provider.Model["api"] }): Provider.Model {
  const { api, ...rest } = overrides
  return {
    id: "test-model" as any,
    providerID: "test-provider" as any,
    name: "Test Model",
    api,
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    ...rest,
  }
}

describe("SystemPrompt.provider", () => {
  test("returns custom prompt when model has prompt field", () => {
    const model = makeModel({
      api: { id: "some-unknown-model", url: "", npm: "" },
      prompt: "You are a custom coding assistant.",
    })
    const result = SystemPrompt.provider(model)
    expect(result).toEqual(["You are a custom coding assistant."])
  })

  test("custom prompt takes priority over model ID matching", () => {
    const model = makeModel({
      api: { id: "claude-sonnet-4", url: "", npm: "" },
      prompt: "Custom prompt overrides claude matching.",
    })
    const result = SystemPrompt.provider(model)
    expect(result).toEqual(["Custom prompt overrides claude matching."])
  })

  test("falls back to claude prompt when no custom prompt and model ID contains claude", () => {
    const model = makeModel({
      api: { id: "claude-sonnet-4", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
    // Should not be the fallback prompt (qwen)
    const fallbackModel = makeModel({
      api: { id: "some-unknown-model", url: "", npm: "" },
    })
    const fallback = SystemPrompt.provider(fallbackModel)
    expect(result[0]).not.toBe(fallback[0])
  })

  test("falls back to gemini prompt for gemini models", () => {
    const model = makeModel({
      api: { id: "gemini-pro", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
  })

  test("falls back to default prompt for unknown models without custom prompt", () => {
    const model = makeModel({
      api: { id: "totally-unknown-model", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
  })

  test("model without prompt field uses default matching", () => {
    const model = makeModel({
      api: { id: "gpt-5-turbo", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    // gpt-5 should match PROMPT_CODEX, not the fallback
    const fallbackModel = makeModel({
      api: { id: "unknown", url: "", npm: "" },
    })
    const fallback = SystemPrompt.provider(fallbackModel)
    expect(result[0]).not.toBe(fallback[0])
  })
})
