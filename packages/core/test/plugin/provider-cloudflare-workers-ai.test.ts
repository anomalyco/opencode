import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { CloudflareWorkersAIPlugin } from "@opencode-ai/core/plugin/provider/cloudflare-workers-ai"
import { Provider } from "@opencode-ai/core/provider"
import { Credential } from "@opencode-ai/core/credential"
import { ID, Info } from "@opencode-ai/core/model"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  yield* CloudflareWorkersAIPlugin.effect(yield* PluginHost.make(plugin))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(value: string | undefined, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.CLOUDFLARE_ACCOUNT_ID
      if (value === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
      else process.env.CLOUDFLARE_ACCOUNT_ID = value
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
        else process.env.CLOUDFLARE_ACCOUNT_ID = previous
      }),
  )
}

const providerID = Provider.ID.make("cloudflare-workers-ai")

describe("CloudflareWorkersAIPlugin", () => {
  it.effect("resolves the account environment variable into the native endpoint", () =>
    withEnv("account/id", () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((draft) =>
          draft.provider.update(providerID, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          }),
        )
        yield* addPlugin()

        expect(required(yield* catalog.provider.get(providerID))).toMatchObject({
          settings: { baseURL: "https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/v1" },
          headers: { "User-Agent": expect.stringContaining("cloudflare-workers-ai") },
        })
      }),
    ),
  )

  it.effect("resolves an account ID from provider settings", () =>
    withEnv(undefined, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((draft) =>
          draft.provider.update(providerID, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
            provider.settings = { accountId: "configured/account" }
          }),
        )
        yield* addPlugin()

        expect(required(yield* catalog.provider.get(providerID)).settings?.baseURL).toBe(
          "https://api.cloudflare.com/client/v4/accounts/configured%2Faccount/ai/v1",
        )
      }),
    ),
  )

  it.effect("resolves an account ID from credential metadata before native routing", () =>
    withEnv(undefined, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const event = yield* (yield* PluginHooks.Service).trigger("provider", "resolve", {
          model: Info.make({
            id: ID.make("model"),
            modelID: ID.make("@cf/model"),
            providerID,
            name: "Model",
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
            settings: {},
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [],
            time: { released: 0 },
            cost: [],
            status: "active",
            enabled: true,
            limit: { context: 128_000, output: 8_192 },
          }),
          credential: Credential.Key.make({ type: "key", key: "secret", metadata: { accountId: "stored/account" } }),
          settings: {
            accountId: "stored/account",
            baseURL: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
          },
        })

        expect(event.settings.baseURL).toBe(
          "https://api.cloudflare.com/client/v4/accounts/stored%2Faccount/ai/v1",
        )
      }),
    ),
  )

  it.effect("expands account placeholders and preserves configured endpoints", () =>
    withEnv("env-account", () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((draft) =>
          draft.provider.update(providerID, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
            provider.settings = {
              baseURL: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
            }
          }),
        )
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(providerID)).settings?.baseURL).toBe(
          "https://api.cloudflare.com/client/v4/accounts/env-account/ai/v1",
        )
      }),
    ),
  )

  it.effect("preserves a custom endpoint when an account ID is configured", () =>
    withEnv(undefined, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((draft) =>
          draft.provider.update(providerID, (provider) => {
            provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
            provider.settings = { accountId: "configured-account", baseURL: "https://proxy.example/v1" }
          }),
        )
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(providerID)).settings?.baseURL).toBe("https://proxy.example/v1")
      }),
    ),
  )
})
