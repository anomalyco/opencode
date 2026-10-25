import { describe, expect, test } from "bun:test"
import { ConfigProviderOptionsV1 } from "@bolt-ai/core/v1/config/provider-options"

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
    })
    expect(ConfigProviderOptionsV1.compatibleModel({ reasoningEffort: "low" })).toEqual({
      settings: { reasoningEffort: "low" },
      body: undefined,
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
