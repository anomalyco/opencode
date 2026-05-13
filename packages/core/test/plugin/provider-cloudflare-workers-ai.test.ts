import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AuthV2 } from "@opencode-ai/core/auth"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AuthPlugin } from "@opencode-ai/core/plugin/auth"
import { CloudflareWorkersAIPlugin } from "@opencode-ai/core/plugin/provider/cloudflare-workers-ai"
import { testEffect } from "../lib/effect"
import { fakeSelectorSdk, it, model, npmLayer, provider, withEnv } from "./provider-helper"

const itWithAuth = testEffect(Layer.mergeAll(PluginV2.defaultLayer, AuthV2.defaultLayer, npmLayer))

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
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const updated = yield* plugin.trigger(
          "provider.update",
          {},
          { provider: provider("cloudflare-workers-ai"), cancel: false },
        )
        const sdk = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: model("cloudflare-workers-ai", "@cf/model", { endpoint: updated.provider.endpoint }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "cloudflare-workers-ai", headers: { custom: "header" } },
          },
          {},
        )
        expect(updated.provider.endpoint).toEqual({
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
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("cloudflare-workers-ai", {
              endpoint: { type: "aisdk", package: "test-provider", url: "https://proxy.example/v1" },
            }),
            cancel: false,
          },
        )
        expect(result.provider.endpoint).toEqual({
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

  itWithAuth.effect("falls back to auth account metadata when account env is absent", () =>
    withEnv(
      {
        CLOUDFLARE_ACCOUNT_ID: undefined,
        CLOUDFLARE_API_KEY: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const auth = yield* AuthV2.Service
          yield* auth.create({
            serviceID: AuthV2.ServiceID.make("cloudflare-workers-ai"),
            credential: new AuthV2.ApiKeyCredential({
              type: "api",
              key: "auth-key",
              metadata: { accountId: "auth-acct" },
            }),
            active: true,
          })
          yield* plugin.add({
            ...AuthPlugin,
            effect: AuthPlugin.effect.pipe(Effect.provideService(AuthV2.Service, auth)),
          })
          yield* plugin.add(CloudflareWorkersAIPlugin)
          const updated = yield* plugin.trigger(
            "provider.update",
            {},
            { provider: provider("cloudflare-workers-ai"), cancel: false },
          )
          expect(updated.provider.endpoint).toEqual({
            type: "aisdk",
            package: "test-provider",
            url: "https://api.cloudflare.com/client/v4/accounts/auth-acct/ai/v1",
          })
        }),
    ),
  )

  it.effect("uses env account ID over configured account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "env-acct" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(CloudflareWorkersAIPlugin)
        const result = yield* plugin.trigger(
          "provider.update",
          {},
          {
            provider: provider("cloudflare-workers-ai", {
              options: { headers: {}, body: {}, aisdk: { provider: { accountId: "configured-acct" }, request: {} } },
            }),
            cancel: false,
          },
        )
        expect(result.provider.endpoint).toEqual({
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
