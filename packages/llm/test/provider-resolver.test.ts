import { describe, expect, test } from "bun:test"
import { Azure, GitHubCopilot, OpenAI, OpenAICompatibleFamily, ProviderResolver, XAI } from "../src"

describe("provider resolver", () => {
  test("fixed providers resolve protocol and auth defaults", () => {
    expect(OpenAI.resolver.resolve(ProviderResolver.input("gpt-5", "openai", {}))).toMatchObject({
      provider: "openai",
      protocol: "openai-responses",
      auth: "key",
    })
  })

  test("dynamic providers can select protocols from model metadata", () => {
    expect(GitHubCopilot.resolver.resolve(ProviderResolver.input("gpt-5", "github-copilot", {}))).toMatchObject({
      provider: "github-copilot",
      protocol: "openai-responses",
      auth: "key",
    })
    expect(GitHubCopilot.resolver.resolve(ProviderResolver.input("gpt-5-mini", "github-copilot", {}))).toMatchObject({
      provider: "github-copilot",
      protocol: "openai-chat",
      auth: "key",
    })
  })

  test("OpenAI-compatible families carry provider-specific defaults", () => {
    expect(OpenAICompatibleFamily.resolver.resolve(ProviderResolver.input("llama", "togetherai", {}))).toMatchObject({
      provider: "togetherai",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.together.xyz/v1",
      auth: "key",
    })
    expect(OpenAICompatibleFamily.resolver.resolve(ProviderResolver.input("llama", "groq", {}))).toMatchObject({
      provider: "groq",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.groq.com/openai/v1",
    })
    expect(OpenAICompatibleFamily.resolver.resolve(ProviderResolver.input("sonar", "perplexity", {}))).toMatchObject({
      provider: "perplexity",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.perplexity.ai",
    })
    expect(OpenAICompatibleFamily.resolver.resolve(ProviderResolver.input("gpt-5", "openrouter", {}))).toMatchObject({
      provider: "openrouter",
      protocol: "openai-compatible-chat",
      baseURL: "https://openrouter.ai/api/v1",
    })
  })

  test("xAI resolves to its OpenAI-compatible chat endpoint", () => {
    expect(XAI.resolver.resolve(ProviderResolver.input("grok-4", "xai", {}))).toMatchObject({
      provider: "xai",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.x.ai/v1",
    })
  })

  test("Azure resolves resource URLs and API-version query params", () => {
    expect(
      Azure.resolver.resolve(
        ProviderResolver.input("gpt-5", "azure", { resourceName: "opencode-test", apiVersion: "2025-04-01-preview" }),
      ),
    ).toMatchObject({
      provider: "azure",
      protocol: "openai-responses",
      baseURL: "https://opencode-test.openai.azure.com/openai/v1",
      queryParams: { "api-version": "2025-04-01-preview" },
    })
    expect(Azure.resolver.resolve(ProviderResolver.input("gpt-4.1", "azure", { useCompletionUrls: true }))).toMatchObject({
      protocol: "openai-chat",
      queryParams: { "api-version": "v1" },
    })
  })
})
