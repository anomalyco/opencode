import { describe, expect, test } from "bun:test"
import { ConfigProviderOptionsV1 } from "@opencode-ai/core/v1/config/provider-options"

describe("ConfigProviderOptionsV1", () => {
  test("keeps raw provider and request options unchanged", () => {
    const lowerer = ConfigProviderOptionsV1.get("custom-provider")

    expect(lowerer.provider({ apiKey: "secret", headers: { "x-test": "1" }, nested: { camelCase: true } })).toEqual({
      body: { apiKey: "secret", headers: { "x-test": "1" }, nested: { camelCase: true } },
    })
    expect(lowerer.request({ nested: { camelCase: true } })).toEqual({ nested: { camelCase: true } })
  })

  test("falls back to raw lowering for prototype property package names", () => {
    expect(ConfigProviderOptionsV1.get("toString").provider({ enabled: true })).toEqual({ body: { enabled: true } })
  })

  test("lowers OpenAI provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/openai")

    expect(
      lowerer.provider({
        apiKey: "secret",
        baseURL: "https://openai.example/v1",
        organization: "org",
        project: "project",
        headers: { "x-test": "1" },
        body: { store: true },
        timeout: 1000,
      }),
    ).toEqual({
      url: "https://openai.example/v1",
      headers: {
        Authorization: "Bearer secret",
        "OpenAI-Organization": "org",
        "OpenAI-Project": "project",
        "x-test": "1",
      },
      body: { store: true },
      settings: { timeout: 1000 },
    })
    expect(
      lowerer.request({
        reasoningEffort: "high",
        reasoningSummary: "auto",
        reasoning: { encryptedContent: true },
        textVerbosity: "low",
        text: { outputFormat: "plain" },
        nestedValue: { camelCase: true },
      }),
    ).toEqual({
      reasoning: { encrypted_content: true, effort: "high", summary: "auto" },
      text: { output_format: "plain", verbosity: "low" },
      nested_value: { camel_case: true },
    })
  })

  test("lowers Anthropic provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/anthropic")

    expect(
      lowerer.provider({
        apiKey: "secret",
        authToken: "token",
        baseURL: "https://anthropic.example",
        headers: { "x-test": "1" },
        body: { beta: true },
        generateId: "custom",
      }),
    ).toEqual({
      url: "https://anthropic.example",
      headers: { "x-api-key": "secret", Authorization: "Bearer token", "x-test": "1" },
      body: { beta: true },
      settings: { generateId: "custom" },
    })
    expect(
      lowerer.request({
        effort: "high",
        taskBudget: 1024,
        metadata: { userId: "user", traceId: "trace" },
        nestedValue: { camelCase: true },
      }),
    ).toEqual({
      output_config: { effort: "high", task_budget: 1024 },
      metadata: { user_id: "user", trace_id: "trace" },
      nested_value: { camel_case: true },
    })
  })

  test("lowers Google provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/google")

    expect(
      lowerer.provider({
        apiKey: "secret",
        baseURL: "https://google.example",
        headers: { "x-test": "1" },
        body: { trace: true },
        project: "project",
      }),
    ).toEqual({
      url: "https://google.example",
      headers: { "x-goog-api-key": "secret", "x-test": "1" },
      body: { trace: true },
      settings: { project: "project" },
    })
    expect(
      lowerer.request({
        thinkingConfig: { thinkingBudget: 1024 },
        responseModalities: ["TEXT"],
        mediaResolution: "high",
        imageConfig: { aspectRatio: "16:9" },
        safetySettings: ["safe"],
      }),
    ).toEqual({
      safetySettings: ["safe"],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 1024 },
        responseModalities: ["TEXT"],
        mediaResolution: "high",
        imageConfig: { aspectRatio: "16:9" },
      },
    })
  })

  test("lowers Azure provider options and uses OpenAI request lowering", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/azure")

    expect(
      lowerer.provider({
        apiKey: "secret",
        baseURL: "https://azure.example",
        headers: { "x-test": "1" },
        body: { trace: true },
        resourceName: "resource",
      }),
    ).toEqual({
      url: "https://azure.example",
      headers: { "api-key": "secret", "x-test": "1" },
      body: { trace: true },
      settings: { resourceName: "resource" },
    })
    expect(lowerer.request({ reasoningEffort: "high", reasoningSummary: "auto", textVerbosity: "low" })).toEqual({
      reasoning: { effort: "high", summary: "auto" },
      text: { verbosity: "low" },
    })
  })

  test("lowers Amazon Bedrock provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/amazon-bedrock")

    expect(
      lowerer.provider({
        headers: { "x-test": "1" },
        body: { trace: true },
        region: "us-east-1",
        profile: "dev",
      }),
    ).toEqual({
      headers: { "x-test": "1" },
      body: { trace: true },
      settings: { region: "us-east-1", profile: "dev" },
    })
    expect(lowerer.request({ temperature: 0.2 })).toEqual({
      additionalModelRequestFields: { temperature: 0.2 },
    })
  })

  test("lowers OpenAI-compatible provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/openai-compatible")

    expect(
      lowerer.provider({
        baseURL: "https://compatible.example/v1",
        headers: { "x-test": "1" },
        body: { trace: true },
        apiKey: "secret",
      }),
    ).toEqual({
      url: "https://compatible.example/v1",
      headers: { "x-test": "1" },
      body: { trace: true },
      settings: { apiKey: "secret" },
    })
    expect(lowerer.request({ reasoningEffort: "high", serviceTier: "priority" })).toEqual({
      reasoning_effort: "high",
      serviceTier: "priority",
    })
  })

  test.each([
    "@ai-sdk/cerebras",
    "@ai-sdk/deepinfra",
    "@ai-sdk/groq",
    "@ai-sdk/mistral",
    "@ai-sdk/togetherai",
    "@ai-sdk/xai",
    "@openrouter/ai-sdk-provider",
    "ai-gateway-provider",
    "venice-ai-sdk-provider",
  ])("uses OpenAI-compatible lowering for %s", (packageName) => {
    const lowerer = ConfigProviderOptionsV1.get(packageName)

    expect(lowerer.provider({ baseURL: "https://example.test", apiKey: "secret" })).toEqual({
      url: "https://example.test",
      headers: undefined,
      body: undefined,
      settings: { apiKey: "secret" },
    })
    expect(lowerer.request({ reasoningEffort: "high" })).toEqual({ reasoning_effort: "high" })
  })

  test.each(["@ai-sdk/google-vertex", "@ai-sdk/google-vertex/anthropic"])(
    "uses provider family lowering for %s",
    (packageName) => {
      const lowerer = ConfigProviderOptionsV1.get(packageName)

      expect(lowerer.provider({ baseURL: "https://example.test", profile: "dev" })).toMatchObject({
        url: "https://example.test",
        settings: { profile: "dev" },
      })
    },
  )
})
