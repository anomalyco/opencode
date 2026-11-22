import { describe, expect, it } from "bun:test"
import { getProviderApiKeyUrl, providerApiKeyUrls } from "./urls"

describe("providerApiKeyUrls", () => {
  it("maps known providers to their API key dashboard URLs", () => {
    expect(getProviderApiKeyUrl("openai")).toBe("https://platform.openai.com/api-keys")
    expect(getProviderApiKeyUrl("anthropic")).toBe("https://console.anthropic.com/settings/keys")
    expect(getProviderApiKeyUrl("google")).toBe("https://aistudio.google.com/app/apikey")
    expect(getProviderApiKeyUrl("deepseek")).toBe("https://platform.deepseek.com/api_keys")
    expect(getProviderApiKeyUrl("groq")).toBe("https://console.groq.com/keys")
    expect(getProviderApiKeyUrl("openrouter")).toBe("https://openrouter.ai/keys")
  })

  it("returns undefined for providers without external API key dashboard or local runtimes", () => {
    expect(getProviderApiKeyUrl("ollama")).toBeUndefined()
    expect(getProviderApiKeyUrl("lmstudio")).toBeUndefined()
    expect(getProviderApiKeyUrl("vllm")).toBeUndefined()
    expect(getProviderApiKeyUrl("custom")).toBeUndefined()
    expect(getProviderApiKeyUrl("non-existent-provider")).toBeUndefined()
  })

  it("has exactly 84 providers with active URLs", () => {
    expect(Object.keys(providerApiKeyUrls).length).toBe(84)
  })
})
