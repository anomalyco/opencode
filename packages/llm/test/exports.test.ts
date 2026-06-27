import { describe, expect, test } from "bun:test"
import { LLM, LLMClient, Provider } from "@opencode-ai/llm"
import { Route, Protocol } from "@opencode-ai/llm/route"
import { Provider as ProviderSubpath } from "@opencode-ai/llm/provider"
import {
  CloudflareAIGateway,
  CloudflareWorkersAI,
  OpenAI,
  OpenAICompatible,
  OpenRouter,
  XAI,
} from "@opencode-ai/llm/providers"
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
    expect(OpenAI.provider.responses).toBe(OpenAI.responses)
    expect(OpenAI.provider.responsesWebSocket).toBe(OpenAI.responsesWebSocket)
    expect(OpenAI.configure({ apiKey: "fixture" }).responses).toBeFunction()
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(CloudflareAIGateway.configure).toBeFunction()
    expect(CloudflareAIGateway.configure({ accountId: "fixture", gatewayApiKey: "fixture" }).model).toBeFunction()
    expect(CloudflareWorkersAI.configure).toBeFunction()
    expect(CloudflareWorkersAI.configure({ accountId: "fixture", apiKey: "fixture" }).model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.provider.model).toBe(OpenRouter.model)
    expect(XAI.model).toBeFunction()
    expect(XAI.provider.model).toBe(XAI.model)
    expect(XAI.provider.responses).toBe(XAI.responses)
    expect(XAI.provider.chat).toBe(XAI.chat)
    expect(XAI.configure({ apiKey: "fixture" }).responses("grok-4.3").route.id).toBe("openai-responses")
    expect(XAI.configure({ apiKey: "fixture" }).chat("grok-4.3").route.id).toBe("openai-compatible-chat")
    expect(
      GitHubCopilot.configure({ baseURL: "https://api.githubcopilot.test", apiKey: "fixture" }).model,
    ).toBeFunction()
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
    expect(OpenAIResponses.route.id).toBe("openai-responses")
    expect(OpenAIResponses.webSocketRoute.id).toBe("openai-responses-websocket")
    expect(AnthropicMessages.route.id).toBe("anthropic-messages")
  })
})
