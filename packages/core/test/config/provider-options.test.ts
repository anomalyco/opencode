import { describe, expect, test } from "bun:test"
import { ConfigProviderOptionsV1 } from "@opencode/core/v1/config/provider-options"

describe("ConfigProviderOptionsV1", () => {
  test("splits provider overlays without changing package settings", () => {
    expect(
      ConfigProviderOptionsV1.provider({
        apiKey: "secret",
        baseURL: "https://openai.example/v1",
        organization: "org",
        headers: { "x-test": "1", invalid: true },
        body: { store: true },
        nested: { camelCase: true },
      }),
    ).toEqual({
      settings: {
        apiKey: "secret",
        baseURL: "https://openai.example/v1",
        organization: "org",
        nested: { camelCase: true },
      },
      headers: { "x-test": "1" },
      body: { store: true },
    })
  })

  test("moves openai-compatible options the package does not read into the body", () => {
    expect(
      ConfigProviderOptionsV1.compatibleModel({
        reasoningEffort: "high",
        timeout: 1000,
        allowed_openai_params: ["reasoning_effort"],
        chat_template_kwargs: { enable_thinking: true },
      }),
    ).toEqual({
      settings: { reasoningEffort: "high", timeout: 1000 },
      body: {
        allowed_openai_params: ["reasoning_effort"],
        chat_template_kwargs: { enable_thinking: true },
      },
      maxTokens: undefined,
    })
    expect(ConfigProviderOptionsV1.compatibleModel({ reasoningEffort: "low" })).toEqual({
      settings: { reasoningEffort: "low" },
      body: undefined,
      maxTokens: undefined,
    })
  })

  test("reports openai-compatible max-token options instead of sending them in the body", () => {
    expect(ConfigProviderOptionsV1.compatibleModel({ reasoningEffort: "high", max_tokens: 262144 })).toEqual({
      settings: { reasoningEffort: "high" },
      body: undefined,
      maxTokens: 262144,
    })
    expect(ConfigProviderOptionsV1.compatibleModel({ max_completion_tokens: 32000, user: "me" })).toEqual({
      settings: { user: "me" },
      body: undefined,
      maxTokens: 32000,
    })
    expect(ConfigProviderOptionsV1.compatibleModel({ maxTokens: 8192, chat_template_kwargs: { a: true } })).toEqual({
      settings: {},
      body: { chat_template_kwargs: { a: true } },
      maxTokens: 8192,
    })
  })

  test("keeps model and variant options unchanged", () => {
    expect(
      ConfigProviderOptionsV1.model({
        reasoningEffort: "high",
        taskBudget: 1024,
        metadata: { userId: "user" },
      }),
    ).toEqual({
      reasoningEffort: "high",
      taskBudget: 1024,
      metadata: { userId: "user" },
    })
  })

  test("uses mechanical lowering for custom provider options", () => {
    expect(ConfigProviderOptionsV1.provider({ enabled: true })).toEqual({
      settings: { enabled: true },
      headers: undefined,
      body: undefined,
    })
  })
})
