import { describe, expect, test } from "bun:test"
import { LLM, LLMClient, Provider } from "@opencode-ai/llm"
import { Route, Protocol } from "@opencode-ai/llm/route"
import { Provider as ProviderSubpath } from "@opencode-ai/llm/provider"
import { Cloudflare, OpenAI, OpenAICompatible, OpenRouter, XAI } from "@opencode-ai/llm/providers"
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

  test("route barrel exposes route-authoring APIs", () => {
    expect(Route.make).toBeFunction()
    expect(Protocol.make).toBeFunction()
  })

  test("provider barrels expose user-facing facades", () => {
    expect(OpenAI.model).toBeFunction()
    expect(OpenAI.provider.model).toBe(OpenAI.model)
    expect(OpenAI.apis.responses).toBe(OpenAI.responses)
    expect(OpenAI.apis.responsesWebSocket).toBe(OpenAI.responsesWebSocket)
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(Cloudflare.model).toBeFunction()
    expect(Cloudflare.provider.model).toBe(Cloudflare.model)
    expect(Cloudflare.aiGateway).toBeFunction()
    expect(Cloudflare.workersAI).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.provider.model).toBe(OpenRouter.model)
    expect(XAI.model).toBeFunction()
    expect(XAI.provider.model).toBe(XAI.model)
    expect(XAI.apis.responses).toBe(XAI.responses)
    expect(XAI.apis.chat).toBe(XAI.chat)
    expect(XAI.responses("grok-4.3", { apiKey: "fixture" })).toMatchObject({
      route: "openai-responses",
    })
    expect(XAI.chat("grok-4.3", { apiKey: "fixture" })).toMatchObject({
      route: "openai-compatible-chat",
    })
    expect(GitHubCopilot.model).toBeFunction()
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
    expect(OpenAIResponses.route.id).toBe("openai-responses")
    expect(OpenAIResponses.webSocketRoute.id).toBe("openai-responses-websocket")
    expect(AnthropicMessages.route.id).toBe("anthropic-messages")
  })
})
