import { describe, expect, test } from "bun:test"
import { LLM, LLMClient, Provider } from "@opencode-ai/llm"
import { Adapter, Protocol } from "@opencode-ai/llm/adapter"
import { Provider as ProviderSubpath } from "@opencode-ai/llm/provider"
import { OpenAI, OpenAICompatible, OpenRouter } from "@opencode-ai/llm/providers"
import * as GitHubCopilot from "@opencode-ai/llm/providers/github-copilot"
import { OpenAIChat, OpenAICompatibleChat, OpenAIResponses } from "@opencode-ai/llm/protocols"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"

describe("public exports", () => {
  test("root exposes app-facing runtime APIs", () => {
    expect(LLM.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(Provider.make).toBeFunction()
    expect(ProviderSubpath.make).toBe(Provider.make)
  })

  test("adapter barrel exposes adapter-authoring APIs", () => {
    expect(Adapter.make).toBeFunction()
    expect(Protocol.define).toBeFunction()
  })

  test("provider barrels expose user-facing facades", () => {
    expect(OpenAI.model).toBeFunction()
    expect(OpenAI.provider.model).toBe(OpenAI.model)
    expect(OpenAI.apis.responses).toBe(OpenAI.responses)
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.provider.model).toBe(OpenRouter.model)
    expect(GitHubCopilot.model).toBeFunction()
  })

  test("protocol barrels expose supported low-level adapters", () => {
    expect(OpenAIChat.adapter.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.adapter.id).toBe("openai-compatible-chat")
    expect(OpenAIResponses.adapter.id).toBe("openai-responses")
    expect(AnthropicMessages.adapter.id).toBe("anthropic-messages")
  })

})
