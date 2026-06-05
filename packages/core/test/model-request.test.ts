import { describe, expect, test } from "bun:test"
import { ModelRequest } from "@opencode-ai/core/model-request"

describe("ModelRequest", () => {
  test("partitions AI SDK model and models.dev mode options", () => {
    expect(
      ModelRequest.normalizeAiSdkOptions("@ai-sdk/openai", {
        maxOutputTokens: 4096,
        temperature: 0.2,
        reasoningEffort: "high",
        serviceTier: "priority",
        custom_extension: { enabled: true },
      }),
    ).toEqual({
      generation: { maxTokens: 4096, temperature: 0.2 },
      options: { reasoningEffort: "high", serviceTier: "priority" },
      body: { custom_extension: { enabled: true } },
    })
  })

  test("keeps unknown-provider options as compatibility fields", () => {
    expect(ModelRequest.normalizeAiSdkOptions(undefined, { temperature: 0.2, reasoningEffort: "high" })).toEqual({
      generation: { temperature: 0.2 },
      options: {},
      body: { reasoningEffort: "high" },
    })
  })

  test("does not consult inherited package-name properties", () => {
    expect(ModelRequest.normalizeAiSdkOptions("__proto__", { reasoningEffort: "high" })).toEqual({
      generation: {},
      options: {},
      body: { reasoningEffort: "high" },
    })
  })

  test("normalizes models.dev wire aliases owned by native protocols", () => {
    expect(ModelRequest.normalizeAiSdkOptions("@ai-sdk/openai", { service_tier: "priority" })).toEqual({
      generation: {},
      options: { serviceTier: "priority" },
      body: {},
    })
  })
})
