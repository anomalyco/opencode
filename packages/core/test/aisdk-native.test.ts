import { describe, expect, test } from "bun:test"
import { AISDKNative } from "@opencode-ai/core/aisdk-native"

describe("AISDKNative", () => {
  test("maps supported xAI settings", () => {
    expect(
      AISDKNative.map("@ai-sdk/xai", {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        reasoningEffort: "high",
        store: true,
        promptCacheKey: "cache-key",
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/xai",
      settings: {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        providerOptions: {
          xai: {
            reasoningEffort: "high",
            store: true,
            promptCacheKey: "cache-key",
          },
        },
      },
    })
  })

  test("omits invalid and unsupported xAI settings", () => {
    expect(
      AISDKNative.map("@ai-sdk/xai", {
        reasoningEffort: "maximum",
        store: "yes",
        include: ["unknown"],
        logprobs: true,
        topLogprobs: 8,
        previousResponseId: "response-id",
        searchParameters: { mode: "auto" },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/xai",
      settings: {},
    })
  })
})
