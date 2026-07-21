import { describe, expect, test } from "bun:test"
import { ImageInput, LLM, LLMClient, Provider } from "@opencode-ai/ai"
import { Route, Protocol } from "@opencode-ai/ai/route"
import { Provider as ProviderSubpath } from "@opencode-ai/ai/provider"
import {
  CloudflareAIGateway,
  CloudflareWorkersAI,
  OpenAI,
  OpenAICompatible,
  OpenRouter,
  XAI,
} from "@opencode-ai/ai/providers"
import * as GitHubCopilot from "@opencode-ai/ai/providers/github-copilot"
import { OpenAIChat, OpenAICompatibleChat, OpenAICompatibleResponses, OpenAIResponses } from "@opencode-ai/ai/protocols"
import * as AnthropicMessages from "@opencode-ai/ai/protocols/anthropic-messages"

describe("public exports", () => {
  test("root exposes app-facing runtime APIs", () => {
    expect(LLM.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(ImageInput.bytes).toBeFunction()
    expect(Provider.make).toBeFunction()
    expect(ProviderSubpath.make).toBe(Provider.make)
  })

  test("route barrel exposes route-authoring APIs", () => {
    expect(Route.make).toBeFunction()
    expect(Protocol.make).toBeFunction()
  })

  test("provider barrels expose user-facing facades", async () => {
    const { OpenAICompatibleResponses } = await import("@opencode-ai/ai/providers")

    expect(OpenAI.model).toBeFunction()
    expect(OpenAI.provider.responses).toBe(OpenAI.responses)
    expect(OpenAI.provider.responsesWebSocket).toBe(OpenAI.responsesWebSocket)
    expect(OpenAI.configure({ apiKey: "fixture" }).responses).toBeFunction()
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(
      OpenAICompatibleResponses.configure({ baseURL: "https://responses.test/v1" }).model("fixture").route.id,
    ).toBe("openai-compatible-responses")
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
    expect(
      GitHubCopilot.configure({
        baseURL: "https://api.githubcopilot.test",
        apiKey: "fixture",
        endpoint: "responses",
      }).model("mai-code-1-flash-picker").route.id,
    ).toBe("openai-responses")
    expect(
      GitHubCopilot.configure({
        baseURL: "https://api.githubcopilot.test",
        apiKey: "fixture",
        endpoint: "chat",
      }).model("gpt-5").route.id,
    ).toBe("openai-chat")
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
    expect(OpenAICompatibleResponses.route.id).toBe("openai-compatible-responses")
    expect(OpenAIResponses.route.id).toBe("openai-responses")
    expect(OpenAIResponses.webSocketRoute.id).toBe("openai-responses-websocket")
    expect(AnthropicMessages.route.id).toBe("anthropic-messages")
  })
})
