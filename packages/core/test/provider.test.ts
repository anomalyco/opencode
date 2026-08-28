import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@opencode-ai/core/provider"

describe("Provider", () => {
  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@opencode-ai/ai/providers/cerebras",
      "@opencode-ai/ai/providers/deepinfra",
      "@opencode-ai/ai/providers/google-vertex",
      "@opencode-ai/ai/providers/google-vertex/gemini",
      "@opencode-ai/ai/providers/google-vertex/chat",
      "@opencode-ai/ai/providers/google-vertex/responses",
      "@opencode-ai/ai/providers/google-vertex/messages",
      "@opencode-ai/ai/providers/groq",
      "@opencode-ai/ai/providers/togetherai",
    ]

    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("detects unprefixed @ai-sdk packages only", () => {
    expect(Provider.looksLikeAISDK("@ai-sdk/openai")).toBe(true)
    expect(Provider.looksLikeAISDK("@ai-sdk/openai-compatible")).toBe(true)
    expect(Provider.looksLikeAISDK("aisdk:@ai-sdk/openai")).toBe(false)
    expect(Provider.looksLikeAISDK("@opencode-ai/ai/providers/openai")).toBe(false)
    expect(Provider.looksLikeAISDK("file:///provider")).toBe(false)
    expect(Provider.looksLikeAISDK("@scope/ai-sdk-provider")).toBe(false)
    expect(Provider.looksLikeAISDK("openai")).toBe(false)
    expect(Provider.looksLikeAISDK("")).toBe(false)
    expect(Provider.looksLikeAISDK(undefined)).toBe(false)
  })

  test("normalizes unprefixed @ai-sdk packages and leaves others alone", () => {
    expect(Provider.normalizeAISDK("@ai-sdk/openai-compatible")).toBe("aisdk:@ai-sdk/openai-compatible")
    expect(Provider.normalizeAISDK("aisdk:@ai-sdk/openai")).toBe("aisdk:@ai-sdk/openai")
    expect(Provider.normalizeAISDK("@opencode-ai/ai/providers/openai")).toBe("@opencode-ai/ai/providers/openai")
    expect(Provider.normalizeAISDK("file:///provider")).toBe("file:///provider")
    expect(Provider.normalizeAISDK("")).toBe("")
    expect(Provider.normalizeAISDK(undefined)).toBeUndefined()
  })
})
