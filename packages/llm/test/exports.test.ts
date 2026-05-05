import { describe, expect, test } from "bun:test"
import { Adapter, LLM, LLMClient, ProviderTransform, Protocol, Transform } from "@opencode-ai/llm"
import { OpenAI, OpenAICompatible, OpenRouter } from "@opencode-ai/llm/providers"
import * as GitHubCopilot from "@opencode-ai/llm/providers/github-copilot"
import { OpenAIChat, OpenAICompatibleChat, OpenAIResponses } from "@opencode-ai/llm/protocols"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as ProviderTransformSubpath from "@opencode-ai/llm/provider-transform"

describe("public exports", () => {
  test("root exposes core runtime and transform APIs", () => {
    expect(Adapter.make).toBeFunction()
    expect(LLM.generate).toBeFunction()
    expect(LLMClient.make).toBeFunction()
    expect(Protocol.define).toBeFunction()
    expect(Transform.prompt).toBeFunction()
    expect(ProviderTransform.defaults.length).toBeGreaterThan(0)
  })

  test("provider barrels expose user-facing facades", () => {
    expect(OpenAI.model).toBeFunction()
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(GitHubCopilot.model).toBeFunction()
  })

  test("protocol barrels expose supported low-level adapters", () => {
    expect(OpenAIChat.adapter.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.adapter.id).toBe("openai-compatible-chat")
    expect(OpenAIResponses.adapter.id).toBe("openai-responses")
    expect(AnthropicMessages.adapter.id).toBe("anthropic-messages")
  })

  test("provider-transform subpath exposes transform defaults", () => {
    expect(ProviderTransformSubpath.defaults).toBe(ProviderTransform.defaults)
  })
})
