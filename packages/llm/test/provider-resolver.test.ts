import { describe, expect, test } from "bun:test"
import { GitHubCopilot, OpenAI, OpenAICompatibleFamily, ProviderResolver } from "../src"

describe("provider resolver", () => {
  test("fixed providers resolve protocol and auth defaults", () => {
    expect(OpenAI.resolver.resolve(ProviderResolver.input("gpt-5", "openai", {}))).toMatchObject({
      provider: "openai",
      protocol: "openai-responses",
      auth: "bearer",
    })
  })

  test("dynamic providers can select protocols from model metadata", () => {
    expect(GitHubCopilot.resolver.resolve(ProviderResolver.input("gpt-5", "github-copilot", {}))).toMatchObject({
      provider: "github-copilot",
      protocol: "openai-responses",
      auth: "bearer",
    })
    expect(GitHubCopilot.resolver.resolve(ProviderResolver.input("gpt-5-mini", "github-copilot", {}))).toMatchObject({
      provider: "github-copilot",
      protocol: "openai-chat",
      auth: "bearer",
    })
  })

  test("OpenAI-compatible families carry provider-specific defaults", () => {
    expect(OpenAICompatibleFamily.resolver.resolve(ProviderResolver.input("llama", "togetherai", {}))).toMatchObject({
      provider: "togetherai",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.together.xyz/v1",
      auth: "bearer",
    })
  })
})
