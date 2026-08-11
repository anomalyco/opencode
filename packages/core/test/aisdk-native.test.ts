import { describe, expect, test } from "bun:test"
import { AISDKNative } from "@opencode-ai/core/aisdk-native"

const map = (packageName: string, settings: Readonly<Record<string, unknown>>, modelID = "test-model") =>
  AISDKNative.map({ packageName, settings, modelID })

describe("AISDKNative", () => {
  test("maps both models.dev Bedrock packages to native providers", () => {
    expect(map("@ai-sdk/amazon-bedrock", { region: "us-east-1" })).toEqual({
      package: "@opencode-ai/ai/providers/amazon-bedrock",
      settings: { region: "us-east-1" },
    })
    expect(map("@ai-sdk/amazon-bedrock/mantle", { region: "us-east-1" }, "openai.gpt-oss-120b")).toEqual({
      package: "@opencode-ai/ai/providers/amazon-bedrock/mantle/responses",
      settings: { region: "us-east-1" },
    })
  })

  test("maps Azure deployments and settings to native routes", () => {
    const settings = {
      apiKey: "secret",
      resourceName: "resource",
      apiVersion: "2025-01-01-preview",
      queryParams: { feature: "enabled" },
      useDeploymentBasedUrls: true,
      reasoningEffort: "high",
    }
    expect(map("@ai-sdk/azure", settings, "deployment")).toEqual({
      package: "@opencode-ai/ai/providers/azure/responses",
      settings: {
        apiKey: "secret",
        resourceName: "resource",
        apiVersion: "2025-01-01-preview",
        queryParams: { feature: "enabled" },
        useDeploymentBasedUrls: true,
        providerOptions: { openai: { reasoningEffort: "high" } },
      },
    })
    expect(map("@ai-sdk/azure", { ...settings, useCompletionUrls: true }, "custom-deployment")?.package).toBe(
      "@opencode-ai/ai/providers/azure/chat",
    )
  })

  test("maps Bedrock provider and request options", () => {
    expect(
      map(
        "@ai-sdk/amazon-bedrock",
        {
          region: "us-east-1",
          topP: 0.8,
          headers: { "x-test": "value" },
          additionalModelRequestFields: {
            existing: true,
            anthropic_beta: ["existing-beta"],
            output_config: { format: "text" },
          },
          reasoningConfig: { type: "adaptive", display: "summarized", maxReasoningEffort: "high" },
          anthropicBeta: ["context-1m-2025-08-07"],
          serviceTier: "priority",
        },
        "anthropic.claude-sonnet-4-6-v1",
      ),
    ).toEqual({
      package: "@opencode-ai/ai/providers/amazon-bedrock",
      settings: { region: "us-east-1", topP: 0.8 },
      headers: { "x-test": "value" },
      body: {
        additionalModelRequestFields: {
          existing: true,
          anthropic_beta: ["existing-beta", "context-1m-2025-08-07"],
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { format: "text", effort: "high" },
        },
        serviceTier: { type: "priority" },
      },
    })

    expect(
      map(
        "@ai-sdk/amazon-bedrock",
        { reasoningConfig: { type: "enabled", maxReasoningEffort: "max" } },
        "amazon.nova-2-lite-v1:0",
      )?.body,
    ).toEqual({
      additionalModelRequestFields: {
        reasoningConfig: { type: "enabled", maxReasoningEffort: "max" },
      },
    })

    expect(
      map("@ai-sdk/amazon-bedrock", { reasoningConfig: { maxReasoningEffort: "high" } }, "openai.gpt-oss-120b-1:0")
        ?.body,
    ).toEqual({ additionalModelRequestFields: { reasoning_effort: "high" } })
  })

  test("maps Bedrock Mantle models to their supported native APIs", () => {
    const settings = {
      bearerToken: "token",
      region: "us-west-2",
      baseURL: "https://mantle.test/v1",
      headers: { "x-test": "value" },
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    }

    expect(map("@ai-sdk/amazon-bedrock/mantle", settings, "openai.gpt-oss-120b")).toEqual({
      package: "@opencode-ai/ai/providers/amazon-bedrock/mantle/responses",
      settings: {
        apiKey: "token",
        baseURL: "https://mantle.test/v1",
        region: "us-west-2",
        providerOptions: {
          openai: {
            reasoningEffort: "high",
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
      },
      headers: { "x-test": "value" },
    })
    expect(map("@ai-sdk/amazon-bedrock/mantle", settings, "openai.gpt-oss-safeguard-20b")?.package).toBe(
      "@opencode-ai/ai/providers/amazon-bedrock/mantle/chat",
    )
    expect(
      map(
        "@ai-sdk/amazon-bedrock/mantle",
        {
          region: "us-west-2",
          baseURL: "https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1",
        },
        "openai.gpt-5.5",
      ),
    ).toMatchObject({ settings: { baseURL: "https://bedrock-mantle.us-west-2.api.aws/openai/v1" } })
  })

  test("maps static Bedrock Mantle credentials without leaking connection options", () => {
    expect(
      map(
        "@ai-sdk/amazon-bedrock/mantle",
        {
          credentials: {
            accessKeyId: "key",
            secretAccessKey: "secret",
            sessionToken: "session",
            region: "eu-west-1",
          },
          baseURL: "https://bedrock-mantle.${AWS_REGION}.api.aws/v1",
          profile: "ignored",
          credentialProvider: "ignored",
          fetch: "ignored",
          store: false,
        },
        "openai.gpt-oss-120b",
      ),
    ).toEqual({
      package: "@opencode-ai/ai/providers/amazon-bedrock/mantle/responses",
      settings: {
        credentials: {
          accessKeyId: "key",
          secretAccessKey: "secret",
          sessionToken: "session",
          region: "eu-west-1",
        },
        baseURL: "https://bedrock-mantle.eu-west-1.api.aws/v1",
        providerOptions: { openai: { store: false } },
      },
    })
  })

  test("maps the legacy Bedrock endpoint override", () => {
    expect(
      map(
        "@ai-sdk/amazon-bedrock/mantle",
        { bearerToken: "token", endpoint: "https://mantle.private/v1", region: "us-east-1" },
        "openai.gpt-oss-120b",
      ),
    ).toMatchObject({ settings: { baseURL: "https://mantle.private/v1" } })
  })

  test("maps OpenRouter settings to native destinations", () => {
    expect(
      map("@openrouter/ai-sdk-provider", {
        appName: "OpenCode",
        appUrl: "https://opencode.ai",
        headers: { "x-openrouter-title": "Configured", "x-provider-api-keys": "Configured BYOK" },
        api_keys: { anthropic: "provider-key" },
        extraBody: { transforms: ["middle-out"] },
        models: ["anthropic/claude-sonnet-4.6"],
        provider: { only: ["anthropic"], require_parameters: true },
        reasoning: { effort: "high" },
        future_option: { enabled: true },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/openrouter",
      settings: {
        providerOptions: {
          openrouter: {
            models: ["anthropic/claude-sonnet-4.6"],
            provider: { only: ["anthropic"], require_parameters: true },
            reasoning: { effort: "high" },
            future_option: { enabled: true },
          },
        },
      },
      headers: {
        "x-openrouter-title": "Configured",
        "HTTP-Referer": "https://opencode.ai",
        "x-provider-api-keys": "Configured BYOK",
      },
      body: { transforms: ["middle-out"] },
    })
  })

  test("maps every Google thinking setting", () => {
    expect(
      map("@ai-sdk/google", {
        cachedContent: "cachedContents/example",
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        serviceTier: "flex",
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
          thinkingLevel: "high",
          unknown: true,
        },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/google",
      settings: {
        providerOptions: {
          gemini: {
            cachedContent: "cachedContents/example",
            safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
            serviceTier: "flex",
            thinkingConfig: {
              thinkingBudget: 0,
              includeThoughts: false,
              thinkingLevel: "high",
            },
          },
        },
      },
    })
  })

  test("maps Google thinking settings independently", () => {
    for (const thinkingConfig of [{ thinkingBudget: -1 }, { includeThoughts: true }, { thinkingLevel: "medium" }]) {
      expect(map("@ai-sdk/google", { thinkingConfig })).toMatchObject({
        settings: { providerOptions: { gemini: { thinkingConfig } } },
      })
    }
  })

  test("maps Google request options without thinking settings", () => {
    expect(
      map("@ai-sdk/google", {
        cachedContent: "cachedContents/example",
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        serviceTier: "future-tier",
      }),
    ).toMatchObject({
      settings: {
        providerOptions: {
          gemini: {
            cachedContent: "cachedContents/example",
            safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
            serviceTier: "future-tier",
          },
        },
      },
    })
  })

  test("maps supported xAI settings", () => {
    expect(
      map("@ai-sdk/xai", {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        reasoningEffort: "custom",
        store: true,
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/xai",
      settings: {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        providerOptions: {
          xai: {
            reasoningEffort: "custom",
            store: true,
          },
        },
      },
    })
  })

  test("omits invalid and unsupported xAI settings", () => {
    expect(
      map("@ai-sdk/xai", {
        reasoningEffort: 10,
        store: "yes",
        include: ["unknown"],
        logprobs: true,
        topLogprobs: 8,
        previousResponseId: "response-id",
        searchParameters: { mode: "auto" },
      }),
    ).toEqual({
      package: "@opencode-ai/ai/providers/xai",
      settings: {},
    })
  })
})
