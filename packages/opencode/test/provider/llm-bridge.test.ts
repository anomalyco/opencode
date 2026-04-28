import { describe, expect, test } from "bun:test"
import { ProviderLLMBridge } from "../../src/provider/llm-bridge"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ProviderTest } from "../fake/provider"
import type { Provider } from "../../src/provider/provider"

const model = (input: {
  readonly id: string
  readonly providerID: string
  readonly npm: string
  readonly apiID?: string
  readonly apiURL?: string
  readonly headers?: Record<string, string>
  readonly options?: Record<string, unknown>
  readonly reasoning?: boolean
  readonly toolcall?: boolean
  readonly variants?: Provider.Model["variants"]
}): Provider.Model => {
  const base = ProviderTest.model()
  return ProviderTest.model({
    id: ModelID.make(input.id),
    providerID: ProviderID.make(input.providerID),
    api: { id: input.apiID ?? input.id, url: input.apiURL ?? "", npm: input.npm },
    capabilities: {
      ...base.capabilities,
      reasoning: input.reasoning ?? false,
      toolcall: input.toolcall ?? true,
    },
    limit: { context: 128_000, output: 32_000 },
    options: input.options ?? {},
    headers: input.headers ?? {},
    variants: input.variants ?? {},
  })
}

const provider = (input: Partial<Provider.Info> & Pick<Provider.Info, "id">) =>
  ProviderTest.info({ ...input, models: input.models ?? {} })

describe("ProviderLLMBridge", () => {
  test("maps OpenAI-style providers to Responses", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.openai, key: "openai-key" }),
      model: model({ id: "gpt-5", providerID: "openai", npm: "@ai-sdk/openai", reasoning: true, variants: { high: {} } }),
    })

    expect(ref).toMatchObject({
      id: "gpt-5",
      provider: "openai",
      protocol: "openai-responses",
      headers: { authorization: "Bearer openai-key" },
      limits: { context: 128_000, output: 32_000 },
    })
    expect(ref?.capabilities.reasoning.efforts).toEqual(["high"])
  })

  test("maps Anthropic headers and cache capability", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({
        id: ProviderID.anthropic,
        key: "anthropic-key",
        options: { headers: { "anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } },
      }),
      model: model({ id: "claude-sonnet-4-5", providerID: "anthropic", npm: "@ai-sdk/anthropic" }),
    })

    expect(ref).toMatchObject({
      protocol: "anthropic-messages",
      headers: {
        "x-api-key": "anthropic-key",
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
      },
    })
    expect(ref?.capabilities.cache).toMatchObject({ prompt: true, contentBlocks: true })
  })

  test("maps Gemini API keys", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.make("google"), options: { apiKey: "google-key" } }),
      model: model({ id: "gemini-2.5-flash", providerID: "google", npm: "@ai-sdk/google" }),
    })

    expect(ref).toMatchObject({
      protocol: "gemini",
      headers: { "x-goog-api-key": "google-key" },
    })
    expect(ref?.capabilities.tools.streamingInput).toBe(false)
  })

  test("maps known OpenAI-compatible provider families", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.make("togetherai"), options: { apiKey: "together-key" } }),
      model: model({
        id: "llama",
        apiID: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        providerID: "togetherai",
        npm: "@ai-sdk/togetherai",
      }),
    })

    expect(ref).toMatchObject({
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      provider: "togetherai",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.together.xyz/v1",
      headers: { authorization: "Bearer together-key" },
    })
  })

  test("maps GitHub Copilot through its provider resolver", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.make("github-copilot"), key: "copilot-key" }),
      model: model({ id: "gpt-5", providerID: "github-copilot", npm: "@ai-sdk/github-copilot" }),
    })

    expect(ref).toMatchObject({
      provider: "github-copilot",
      protocol: "openai-responses",
      headers: { authorization: "Bearer copilot-key" },
    })
  })

  test("maps Azure to Responses with resource URL and api-version query", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({
        id: ProviderID.make("azure"),
        key: "azure-key",
        options: { resourceName: "opencode-test", apiVersion: "2025-04-01-preview" },
      }),
      model: model({ id: "gpt-5", providerID: "azure", npm: "@ai-sdk/azure" }),
    })

    expect(ref).toMatchObject({
      provider: "azure",
      protocol: "openai-responses",
      baseURL: "https://opencode-test.openai.azure.com/openai/v1",
      headers: { authorization: "Bearer azure-key" },
      native: { queryParams: { "api-version": "2025-04-01-preview" } },
    })
  })

  test("maps Azure completion URL opt-in to Chat Completions", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.make("azure"), key: "azure-key", options: { resourceName: "opencode-test" } }),
      model: model({ id: "gpt-4.1", providerID: "azure", npm: "@ai-sdk/azure", options: { useCompletionUrls: true } }),
    })

    expect(ref).toMatchObject({
      provider: "azure",
      protocol: "openai-chat",
      baseURL: "https://opencode-test.openai.azure.com/openai/v1",
      native: { queryParams: { "api-version": "v1" } },
    })
  })

  test("keeps provider and model overrides ahead of defaults", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({
        id: ProviderID.make("cerebras"),
        key: "cerebras-key",
        options: {
          baseURL: "https://custom.cerebras.test/v1",
          headers: { "X-Cerebras-3rd-Party-Integration": "opencode" },
        },
      }),
      model: model({
        id: "cerebras-model",
        providerID: "cerebras",
        npm: "@ai-sdk/cerebras",
        headers: { "x-model-header": "1" },
      }),
    })

    expect(ref).toMatchObject({
      protocol: "openai-compatible-chat",
      baseURL: "https://custom.cerebras.test/v1",
      headers: {
        authorization: "Bearer cerebras-key",
        "X-Cerebras-3rd-Party-Integration": "opencode",
        "x-model-header": "1",
      },
    })
  })

  test("maps Amazon Bedrock to Converse with bearer auth and content-block cache", () => {
    const ref = ProviderLLMBridge.toModelRef({
      provider: provider({ id: ProviderID.make("amazon-bedrock"), key: "bedrock-bearer-key" }),
      model: model({
        id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        providerID: "amazon-bedrock",
        npm: "@ai-sdk/amazon-bedrock",
      }),
    })

    expect(ref).toMatchObject({
      protocol: "bedrock-converse",
      headers: { authorization: "Bearer bedrock-bearer-key" },
    })
    // Bedrock Converse supports both prompt-level and positional content-block
    // cache markers (cachePoint blocks landed in 9d7d518ac).
    expect(ref?.capabilities.cache).toMatchObject({ prompt: true, contentBlocks: true })
  })

  test("leaves undecided provider packages unmapped", () => {
    const unsupported = [
      ["mistral", "mistral-large", "@ai-sdk/mistral"],
    ] as const

    expect(
      unsupported.map(([providerID, modelID, npm]) =>
        ProviderLLMBridge.toModelRef({
          provider: provider({ id: ProviderID.make(providerID), key: `${providerID}-key` }),
          model: model({ id: modelID, providerID, npm }),
        }),
      ),
    ).toEqual([undefined, undefined])
  })
})
