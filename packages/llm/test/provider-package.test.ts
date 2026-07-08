import { describe, expect, test } from "bun:test"
import { model } from "@opencode-ai/llm/providers/openai"

describe("provider package entrypoints", () => {
  test("semantic API aliases expose the same contract", async () => {
    const modules = await Promise.all([
      import("@opencode-ai/llm/providers/openai"),
      import("@opencode-ai/llm/providers/openai/responses"),
      import("@opencode-ai/llm/providers/openai/chat"),
      import("@opencode-ai/llm/providers/anthropic"),
      import("@opencode-ai/llm/providers/openai-compatible"),
      import("@opencode-ai/llm/providers/amazon-bedrock"),
      import("@opencode-ai/llm/providers/azure"),
      import("@opencode-ai/llm/providers/azure/responses"),
      import("@opencode-ai/llm/providers/azure/chat"),
      import("@opencode-ai/llm/providers/google"),
    ])

    for (const module of modules) expect(module.model).toBeFunction()
    expect(modules[0].model).toBe(modules[1].model)
    expect(modules[6].model).toBe(modules[7].model)
  })

  test("maps package settings onto the executable model", () => {
    const selected = model("gpt-5", {
      apiKey: "fixture",
      baseURL: "https://api.openai.test/v1",
      headers: { "x-application": "opencode" },
      body: { service_tier: "priority" },
      limits: { context: 200_000, output: 64_000 },
      unrelatedInheritedSetting: true,
    })

    expect(selected.route.id).toBe("openai-responses")
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(selected.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
  })

  test("selects transport without changing the semantic API", () => {
    expect(model("gpt-5", { apiKey: "fixture" }).route.id).toBe("openai-responses")
    expect(model("gpt-5", { apiKey: "fixture", transport: "websocket" }).route.id).toBe("openai-responses-websocket")
  })

  test("maps legacy OpenAI organization and project settings to headers", () => {
    const selected = model("gpt-5", {
      apiKey: "fixture",
      organization: "org_123",
      project: "proj_123",
    })

    expect(selected.route.defaults.headers).toMatchObject({
      "OpenAI-Organization": "org_123",
      "OpenAI-Project": "proj_123",
    })
  })

  test("selects Azure API entrypoints with the same model contract", async () => {
    const Azure = await import("@opencode-ai/llm/providers/azure")
    const AzureChat = await import("@opencode-ai/llm/providers/azure/chat")
    const AzureResponses = await import("@opencode-ai/llm/providers/azure/responses")
    const settings = {
      apiKey: "fixture",
      resourceName: "opencode-test",
      headers: { "x-application": "opencode" },
      body: { service_tier: "priority" },
      limits: { context: 200_000, output: 64_000 },
    }

    const responses = AzureResponses.model("deployment", settings)
    const chat = AzureChat.model("deployment", settings)

    expect(Azure.model("deployment", settings).route.id).toBe("azure-openai-responses")
    expect(responses.route.id).toBe("azure-openai-responses")
    expect(responses.route.endpoint.baseURL).toBe("https://opencode-test.openai.azure.com/openai/v1")
    expect(responses.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(responses.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(responses.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
    expect(chat.route.id).toBe("azure-openai-chat")
  })

  test("maps Google package settings onto the Gemini model", async () => {
    const Google = await import("@opencode-ai/llm/providers/google")
    const selected = Google.model("gemini-2.5-flash", {
      apiKey: "fixture",
      baseURL: "https://generativelanguage.test/v1beta",
      headers: { "x-application": "opencode" },
      body: { safetySettings: [] },
      limits: { context: 1_000_000, output: 65_536 },
      providerOptions: { gemini: { thinkingConfig: { thinkingBudget: 1_024 } } },
    })

    expect(selected.route.id).toBe("gemini")
    expect(selected.route.endpoint.baseURL).toBe("https://generativelanguage.test/v1beta")
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ safetySettings: [] })
    expect(selected.route.defaults.limits).toEqual({ context: 1_000_000, output: 65_536 })
    expect(selected.route.defaults.providerOptions).toEqual({
      gemini: { thinkingConfig: { thinkingBudget: 1_024 } },
    })
  })
})
