import { describe, expect, test } from "bun:test"
import { AISDKNative } from "@opencode-ai/core/aisdk-native"

describe("AISDKNative", () => {
  test("maps every Google thinking setting", () => {
    expect(
      AISDKNative.map("@ai-sdk/google", {
        cachedContent: "cachedContents/example",
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        serviceTier: "flex",
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
          thinkingLevel: "high",
          unknown: true,
        },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/google",
      settings: {
        providerOptions: {
          gemini: {
            cachedContent: "cachedContents/example",
            safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
            serviceTier: "flex",
            thinkingConfig: {
              thinkingBudget: 0,
              includeThoughts: false,
              thinkingLevel: "high",
            },
          },
        },
      },
    })
  })

  test("maps Google thinking settings independently", () => {
    for (const thinkingConfig of [{ thinkingBudget: -1 }, { includeThoughts: true }, { thinkingLevel: "medium" }]) {
      expect(AISDKNative.map("@ai-sdk/google", { thinkingConfig })).toMatchObject({
        settings: { providerOptions: { gemini: { thinkingConfig } } },
      })
    }
  })

  test("maps Google request options without thinking settings", () => {
    expect(
      AISDKNative.map("@ai-sdk/google", {
        cachedContent: "cachedContents/example",
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        serviceTier: "future-tier",
      }),
    ).toMatchObject({
      settings: {
        providerOptions: {
          gemini: {
            cachedContent: "cachedContents/example",
            safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
            serviceTier: "future-tier",
          },
        },
      },
    })
  })

  test("maps supported xAI settings", () => {
    expect(
      AISDKNative.map("@ai-sdk/xai", {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        reasoningEffort: "custom",
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
            reasoningEffort: "custom",
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
        reasoningEffort: 10,
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
