import { describe, expect, test } from "bun:test"
import { AIError, ImageInput, LanguageModel, LLM, LLMClient, Provider } from "@opencode-ai/ai"
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
import {
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAICompatibleResponses,
  OpenAIResponses,
  OpenResponses,
} from "@opencode-ai/ai/protocols"
import * as AnthropicMessages from "@opencode-ai/ai/protocols/anthropic-messages"
import { TestLLM } from "@opencode-ai/ai/testing"

describe("public exports", () => {
  test("root exposes app-facing runtime APIs", () => {
    expect(LLM.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(AIError).toBeFunction()
    expect(LanguageModel.make).toBeFunction()
    expect(ImageInput.bytes).toBeFunction()
    expect(Provider.make).toBeFunction()
    expect(ProviderSubpath.make).toBe(Provider.make)
    expect(TestLLM.layer).toBeFunction()
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
    expect(XAI.model).toBeFunction()
    expect(XAI.provider.responses).toBe(XAI.responses)
    expect(XAI.provider.chat).toBe(XAI.chat)
    expect(XAI.configure({ apiKey: "fixture" }).responses("grok-4.3").route.id).toBe("openai-responses")
    expect(XAI.configure({ apiKey: "fixture" }).chat("grok-4.3").route.id).toBe("openai-compatible-chat")
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
    expect(OpenResponses.protocol.id).toBe("open-responses")
    expect(OpenAICompatibleResponses.route.id).toBe("openai-compatible-responses")
    expect(OpenAICompatibleResponses.route.protocol).toBe("open-responses")
    expect(OpenAIResponses.route.id).toBe("openai-responses")
    expect(OpenAIResponses.webSocketRoute.id).toBe("openai-responses-websocket")
    expect(AnthropicMessages.route.id).toBe("anthropic-messages")
  })
})
