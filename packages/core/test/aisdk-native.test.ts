import { describe, expect, test } from "bun:test"
import { AISDKNative } from "@opencode-ai/core/aisdk-native"

describe("AISDKNative", () => {
  test("maps OpenRouter settings to native destinations", () => {
    expect(
      AISDKNative.map("@openrouter/ai-sdk-provider", {
        appName: "OpenCode",
        appUrl: "https://opencode.ai",
        headers: { "x-openrouter-title": "Configured", "x-provider-api-keys": "Configured BYOK" },
        api_keys: { anthropic: "provider-key" },
        extraBody: { transforms: ["middle-out"] },
        models: ["anthropic/claude-sonnet-4.6"],
        provider: { only: ["anthropic"], require_parameters: true },
        reasoning: { effort: "high" },
        promptCacheKey: "session_123",
        future_option: { enabled: true },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/openrouter",
      settings: {
        providerOptions: {
          openrouter: {
            models: ["anthropic/claude-sonnet-4.6"],
            provider: { only: ["anthropic"], require_parameters: true },
            reasoning: { effort: "high" },
            promptCacheKey: "session_123",
            future_option: { enabled: true },
          },
        },
      },
      headers: {
        "x-openrouter-title": "Configured",
        "HTTP-Referer": "https://opencode.ai",
        "x-provider-api-keys": "Configured BYOK",
      },
      body: { transforms: ["middle-out"] },
    })
  })

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
