import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AmazonBedrockPlugin } from "@opencode-ai/core/plugin/provider/amazon-bedrock"
import { fakeSelectorSdk, it, model, provider, withEnv } from "./provider-helper"

function bedrockBaseURL(sdk: unknown, modelID = "anthropic.claude-sonnet-4-5") {
  const language = (sdk as { languageModel: (id: string) => unknown }).languageModel(modelID)
  return (language as { config: { baseUrl: () => string } }).config.baseUrl()
}

function bedrockFetch(sdk: unknown, modelID = "anthropic.claude-sonnet-4-5") {
  const language = (sdk as { languageModel: (id: string) => unknown }).languageModel(modelID)
  return (
    language as { config: { fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> } }
  ).config.fetch
}

describe("AmazonBedrockPlugin", () => {
  it.effect("moves endpoint option to endpoint URL", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(AmazonBedrockPlugin)
      const result = yield* plugin.trigger(
        "provider.update",
        {},
        {
          provider: provider("amazon-bedrock", {
            options: {
              headers: {},
              body: {},
              aisdk: { provider: { endpoint: "https://bedrock.example" }, request: {} },
            },
          }),
          cancel: false,
        },
      )
      expect(result.provider.endpoint).toEqual({
        type: "aisdk",
        package: "test-provider",
        url: "https://bedrock.example",
      })
      expect(result.provider.options.aisdk.provider.endpoint).toBeUndefined()
    }),
  )

  it.effect("prefers endpoint over baseURL for SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: {
              name: "amazon-bedrock",
              bearerToken: "token",
              baseURL: "https://base.example",
              endpoint: "https://endpoint.example",
              region: "us-east-1",
            },
          },
          {},
        )
        expect(bedrockBaseURL(result.sdk)).toBe("https://endpoint.example")
      }),
    ),
  )

  it.effect("uses baseURL as SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: {
              name: "amazon-bedrock",
              bearerToken: "token",
              baseURL: "https://base.example",
              region: "us-east-1",
            },
          },
          {},
        )
        expect(bedrockBaseURL(result.sdk)).toBe("https://base.example")
      }),
    ),
  )

  it.effect("creates SDK without explicit credential env so the default AWS chain can resolve credentials", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: undefined,
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
        AWS_PROFILE: undefined,
        AWS_REGION: undefined,
        AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          yield* plugin.add(AmazonBedrockPlugin)
          const result = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
              package: "@ai-sdk/amazon-bedrock",
              options: { name: "amazon-bedrock" },
            },
            {},
          )
          expect(result.sdk).toBeDefined()
          expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.us-east-1.amazonaws.com")
        }),
    ),
  )

  it.effect("uses config region over AWS_REGION for SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: "us-east-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: { name: "amazon-bedrock", region: "eu-west-1" },
          },
          {},
        )
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com")
      }),
    ),
  )

  it.effect("uses AWS_REGION for SDK base URL when config region is absent", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: "eu-west-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: { name: "amazon-bedrock" },
          },
          {},
        )
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com")
      }),
    ),
  )

  it.effect("defaults SDK region to us-east-1", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: { name: "amazon-bedrock" },
          },
          {},
        )
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.us-east-1.amazonaws.com")
      }),
    ),
  )

  it.effect("loads bearer token option into env and uses bearer auth", () =>
    withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const headers: Array<string | null> = []
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: {
              name: "amazon-bedrock",
              bearerToken: "option-token",
              fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                headers.push(new Headers(init?.headers).get("Authorization"))
                return new Response("{}")
              },
            },
          },
          {},
        )
        yield* Effect.promise(() => bedrockFetch(result.sdk)("https://bedrock.example", { method: "POST" }))
        expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe("option-token")
        expect(headers).toEqual(["Bearer option-token"])
      }),
    ),
  )

  it.effect("prefers bearer token env over bearer token option", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "env-token" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const headers: Array<string | null> = []
        yield* plugin.add(AmazonBedrockPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            package: "@ai-sdk/amazon-bedrock",
            options: {
              name: "amazon-bedrock",
              bearerToken: "option-token",
              fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                headers.push(new Headers(init?.headers).get("Authorization"))
                return new Response("{}")
              },
            },
          },
          {},
        )
        yield* Effect.promise(() => bedrockFetch(result.sdk)("https://bedrock.example", { method: "POST" }))
        expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe("env-token")
        expect(headers).toEqual(["Bearer env-token"])
      }),
    ),
  )

  it.effect("uses SigV4 credential env when bearer token is absent", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: "test-access-key",
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_REGION: "us-east-1",
        AWS_SECRET_ACCESS_KEY: "test-secret-key",
        AWS_SESSION_TOKEN: "test-session-token",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const headers: Array<string | null> = []
          yield* plugin.add(AmazonBedrockPlugin)
          const result = yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
              package: "@ai-sdk/amazon-bedrock",
              options: {
                name: "amazon-bedrock",
                fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                  headers.push(new Headers(init?.headers).get("Authorization"))
                  return new Response("{}")
                },
              },
            },
            {},
          )
          yield* Effect.promise(() =>
            bedrockFetch(result.sdk)("https://bedrock-runtime.us-east-1.amazonaws.com/model/test/invoke", {
              body: "{}",
              method: "POST",
            }),
          )
          expect(headers[0]?.startsWith("AWS4-HMAC-SHA256 ")).toBe(true)
        }),
    ),
  )

  it.effect("applies legacy cross-region inference prefixes", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AmazonBedrockPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: "eu-west-1" },
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("amazon-bedrock", "global.anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: "eu-west-1" },
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: "ap-northeast-1" },
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: "ap-southeast-2" },
        },
        {},
      )
      expect(calls).toEqual([
        "languageModel:us.anthropic.claude-sonnet-4-5",
        "languageModel:eu.anthropic.claude-sonnet-4-5",
        "languageModel:global.anthropic.claude-sonnet-4-5",
        "languageModel:jp.anthropic.claude-sonnet-4-5",
        "languageModel:au.anthropic.claude-sonnet-4-5",
      ])
    }),
  )

  it.effect("uses AWS_REGION for language prefixes when region option is absent", () =>
    withEnv({ AWS_REGION: "eu-west-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const calls: string[] = []
        yield* plugin.add(AmazonBedrockPlugin)
        yield* plugin.trigger(
          "aisdk.language",
          {
            model: model("amazon-bedrock", "anthropic.claude-sonnet-4-5"),
            sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
            options: {},
          },
          {},
        )
        expect(calls).toEqual(["languageModel:eu.anthropic.claude-sonnet-4-5"])
      }),
    ),
  )

  it.effect("applies the full legacy cross-region prefix matrix", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      const cases = [
        { region: "us-east-1", modelID: "amazon.nova-micro-v1:0", expected: "us.amazon.nova-micro-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-lite-v1:0", expected: "us.amazon.nova-lite-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-pro-v1:0", expected: "us.amazon.nova-pro-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-premier-v1:0", expected: "us.amazon.nova-premier-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-2-lite-v1:0", expected: "us.amazon.nova-2-lite-v1:0" },
        { region: "us-east-1", modelID: "anthropic.claude-sonnet-4-5", expected: "us.anthropic.claude-sonnet-4-5" },
        { region: "us-east-1", modelID: "deepseek.r1-v1:0", expected: "us.deepseek.r1-v1:0" },
        { region: "us-gov-west-1", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        { region: "us-east-1", modelID: "cohere.command-r-plus-v1:0", expected: "cohere.command-r-plus-v1:0" },
        { region: "eu-west-1", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-west-2", modelID: "amazon.nova-lite-v1:0", expected: "eu.amazon.nova-lite-v1:0" },
        { region: "eu-west-3", modelID: "amazon.nova-micro-v1:0", expected: "eu.amazon.nova-micro-v1:0" },
        {
          region: "eu-north-1",
          modelID: "meta.llama3-70b-instruct-v1:0",
          expected: "eu.meta.llama3-70b-instruct-v1:0",
        },
        { region: "eu-central-1", modelID: "mistral.pixtral-large-v1:0", expected: "eu.mistral.pixtral-large-v1:0" },
        { region: "eu-south-1", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-south-2", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-central-2", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        { region: "eu-west-1", modelID: "cohere.command-r-plus-v1:0", expected: "cohere.command-r-plus-v1:0" },
        {
          region: "ap-southeast-2",
          modelID: "anthropic.claude-sonnet-4-5",
          expected: "au.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-southeast-4",
          modelID: "anthropic.claude-haiku-v1:0",
          expected: "au.anthropic.claude-haiku-v1:0",
        },
        { region: "ap-southeast-2", modelID: "anthropic.claude-opus-4", expected: "apac.anthropic.claude-opus-4" },
        {
          region: "ap-northeast-1",
          modelID: "anthropic.claude-sonnet-4-5",
          expected: "jp.anthropic.claude-sonnet-4-5",
        },
        { region: "ap-northeast-1", modelID: "amazon.nova-pro-v1:0", expected: "jp.amazon.nova-pro-v1:0" },
        { region: "ap-south-1", modelID: "anthropic.claude-sonnet-4-5", expected: "apac.anthropic.claude-sonnet-4-5" },
        { region: "ap-south-1", modelID: "amazon.nova-lite-v1:0", expected: "apac.amazon.nova-lite-v1:0" },
        { region: "ca-central-1", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        {
          region: "us-east-1",
          modelID: "global.anthropic.claude-sonnet-4-5",
          expected: "global.anthropic.claude-sonnet-4-5",
        },
        { region: "us-east-1", modelID: "us.anthropic.claude-sonnet-4-5", expected: "us.anthropic.claude-sonnet-4-5" },
        { region: "eu-west-1", modelID: "eu.anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        {
          region: "ap-northeast-1",
          modelID: "jp.anthropic.claude-sonnet-4-5",
          expected: "jp.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-south-1",
          modelID: "apac.anthropic.claude-sonnet-4-5",
          expected: "apac.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-southeast-2",
          modelID: "au.anthropic.claude-sonnet-4-5",
          expected: "au.anthropic.claude-sonnet-4-5",
        },
      ]
      yield* plugin.add(AmazonBedrockPlugin)
      for (const item of cases) {
        yield* plugin.trigger(
          "aisdk.language",
          {
            model: model("amazon-bedrock", item.modelID),
            sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
            options: { region: item.region },
          },
          {},
        )
      }
      expect(calls).toEqual(cases.map((item) => `languageModel:${item.expected}`))
    }),
  )

  it.effect("ignores non-Bedrock providers for language selection", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(AmazonBedrockPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("openai", "anthropic.claude-sonnet-4-5"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: "eu-west-1" },
        },
        {},
      )
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
