import { describe, expect, test } from "bun:test"
import { Adapter, LLM, LLMClient, Protocol } from "@opencode-ai/llm"
import { OpenAI, OpenAICompatible, OpenRouter } from "@opencode-ai/llm/providers"
import * as GitHubCopilot from "@opencode-ai/llm/providers/github-copilot"
import { OpenAIChat, OpenAICompatibleChat, OpenAIResponses } from "@opencode-ai/llm/protocols"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"

describe("public exports", () => {
  test("root exposes core runtime APIs", () => {
    expect(Adapter.make).toBeFunction()
    expect(LLM.generate).toBeFunction()
    expect(LLMClient.make).toBeFunction()
    expect(Protocol.define).toBeFunction()
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

})
