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
    ])

    for (const module of modules) expect(module.model).toBeFunction()
    expect(modules[0].model).toBe(modules[1].model)
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
})
