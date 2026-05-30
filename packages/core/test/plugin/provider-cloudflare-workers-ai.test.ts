import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AccountV2 } from "@opencode-ai/core/account"
import { Catalog } from "@opencode-ai/core/catalog"
import { Location } from "@opencode-ai/core/location"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Policy } from "@opencode-ai/core/policy"
import { AccountPlugin } from "@opencode-ai/core/plugin/account"
import { CloudflareWorkersAIPlugin } from "@opencode-ai/core/plugin/provider/cloudflare-workers-ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { fakeSelectorSdk, it, model, npmLayer, withEnv } from "./provider-helper"

const itWithAccount = testEffect(
  Catalog.layer.pipe(
    Layer.provideMerge(PluginV2.defaultLayer),
    Layer.provideMerge(AccountV2.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provide(Policy.defaultLayer),
    Layer.provideMerge(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("test") }))),
    ),
    Layer.provideMerge(npmLayer),
  ),
)

function cloudflareLanguage(sdk: unknown, modelID = "@cf/model") {
  return (sdk as { languageModel: (id: string) => { config: CloudflareConfig; provider: string } }).languageModel(
    modelID,
  )
}

type CloudflareConfig = {
  url: (input: { path: string; modelId: string }) => string
  headers: () => Record<string, string> | Promise<Record<string, string>>
}

function cloudflareURL(sdk: unknown, modelID = "@cf/model") {
  return cloudflareLanguage(sdk, modelID).config.url({ path: "/chat/completions", modelId: modelID })
}

function cloudflareHeaders(sdk: unknown, modelID = "@cf/model") {
  return cloudflareLanguage(sdk, modelID).config.headers()
}

describe("CloudflareWorkersAIPlugin", () => {
  it.effect("maps account ID to endpoint URL and creates an OpenAI-compatible SDK", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) =>
          catalog.provider.update(ProviderV2.ID.make("cloudflare-workers-ai"), (provider) => {
            provider.endpoint = { type: "aisdk", package: "test-provider" }
          }),
        )
        const provider = yield* catalog.provider.get(ProviderV2.ID.make("cloudflare-workers-ai"))
        const sdk = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", { endpoint: provider.endpoint }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "cloudflare-workers-ai", headers: { custom: "header" } },
          },
          {},
        )
        expect(provider.endpoint).toEqual({
          type: "aisdk",
          package: "test-provider",
          url: "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1",
        })
        expect(sdk.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("preserves a configured endpoint URL instead of deriving one from account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) =>
          catalog.provider.update(ProviderV2.ID.make("cloudflare-workers-ai"), (provider) => {
            provider.endpoint = { type: "aisdk", package: "test-provider", url: "https://proxy.example/v1" }
          }),
        )
        expect((yield* catalog.provider.get(ProviderV2.ID.make("cloudflare-workers-ai"))).endpoint).toEqual({
          type: "aisdk",
          package: "test-provider",
          url: "https://proxy.example/v1",
        })
      }),
    ),
  )

  it.effect("allows a configured baseURL without account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", {
              endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://proxy.example/v1" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "cloudflare-workers-ai", baseURL: "https://proxy.example/v1" },
          },
          {},
        )
        expect(cloudflareURL(result.sdk)).toBe("https://proxy.example/v1/chat/completions")
      }),
    ),
  )

  itWithAccount.effect("falls back to account metadata when account env is absent", () =>
    withEnv(
      {
        CLOUDFLARE_ACCOUNT_ID: undefined,
        CLOUDFLARE_API_KEY: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const accounts = yield* AccountV2.Service
          const catalog = yield* Catalog.Service
          const events = yield* EventV2.Service
          yield* accounts.create({
            serviceID: AccountV2.ServiceID.make("cloudflare-workers-ai"),
            credential: new AccountV2.ApiKeyCredential({
              type: "api",
              key: "account-key",
              metadata: { accountId: "account-acct" },
            }),
          })
          yield* plugin.add({
            ...AccountPlugin,
            effect: AccountPlugin.effect.pipe(
              Effect.provideService(AccountV2.Service, accounts),
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(EventV2.Service, events),
              Effect.provideService(PluginV2.Service, plugin),
            ),
          })
          yield* plugin.add(CloudflareWorkersAIPlugin)
          const transform = yield* catalog.transform()
          yield* transform((catalog) =>
            catalog.provider.update(ProviderV2.ID.make("cloudflare-workers-ai"), (provider) => {
              provider.endpoint = { type: "aisdk", package: "test-provider" }
            }),
          )
          expect((yield* catalog.provider.get(ProviderV2.ID.make("cloudflare-workers-ai"))).endpoint).toEqual({
            type: "aisdk",
            package: "test-provider",
            url: "https://api.cloudflare.com/client/v4/accounts/account-acct/ai/v1",
          })
        }),
    ),
  )

  it.effect("uses env account ID over configured account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "env-acct" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) =>
          catalog.provider.update(ProviderV2.ID.make("cloudflare-workers-ai"), (provider) => {
            provider.endpoint = { type: "aisdk", package: "test-provider" }
            provider.options.aisdk.provider.accountId = "configured-acct"
          }),
        )
        expect((yield* catalog.provider.get(ProviderV2.ID.make("cloudflare-workers-ai"))).endpoint).toEqual({
          type: "aisdk",
          package: "test-provider",
          url: "https://api.cloudflare.com/client/v4/accounts/env-acct/ai/v1",
        })
      }),
    ),
  )

  it.effect("uses env API key over auth or configured API key and keeps the Cloudflare User-Agent", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "env-key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", {
              endpoint: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://proxy.example/v1" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: {
              name: "cloudflare-workers-ai",
              apiKey: "auth-key",
              baseURL: "https://proxy.example/v1",
              headers: { custom: "header" },
            },
          },
          {},
        )
        const headers = yield* Effect.promise(() => Promise.resolve(cloudflareHeaders(result.sdk)))
        expect(headers.authorization).toBe("Bearer env-key")
        expect(headers.custom).toBe("header")
        expect(headers["user-agent"]).toMatch(/^opencode\/.* cloudflare-workers-ai \(.+\) ai-sdk\/openai-compatible\//)
      }),
    ),
  )

  it.effect("expands account ID vars in endpoint URLs", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", {
              endpoint: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
              },
            }),
            package: "@ai-sdk/openai-compatible",
            options: {
              name: "cloudflare-workers-ai",
              baseURL: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
            },
          },
          {},
        )
        expect(cloudflareURL(result.sdk)).toBe(
          "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions",
        )
      }),
    ),
  )

  it.effect("selects languageModel with the API model ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(CloudflareWorkersAIPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("cloudflare-workers-ai", "alias", { apiID: ModelV2.ID.make("@cf/api-model") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      expect(result.language).toBeDefined()
      expect(calls).toEqual(["languageModel:@cf/api-model"])
    }),
  )

  it.effect("does not create an SDK for non OpenAI-compatible packages", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", {
              endpoint: { type: "aisdk", package: "@ai-sdk/anthropic", url: "https://proxy.example/v1" },
            }),
            package: "@ai-sdk/anthropic",
            options: { name: "cloudflare-workers-ai" },
          },
          {},
        )
        expect(result.sdk).toBeUndefined()
      }),
    ),
  )
})
