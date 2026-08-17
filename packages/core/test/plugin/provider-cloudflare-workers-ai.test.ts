import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CloudflareWorkersAIPlugin } from "@opencode-ai/core/plugin/provider/cloudflare-workers-ai"
import { Provider } from "@opencode-ai/core/provider"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* CloudflareWorkersAIPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

describe("CloudflareWorkersAIPlugin", () => {
  it.effect("registers an account form when the environment does not provide one", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        expect(
          (yield* (yield* Integration.Service).get(Integration.ID.make("cloudflare-workers-ai")))?.methods,
        ).toContainEqual({
          type: "key",
          label: "API key",
          form: [
            {
              type: "string",
              key: "accountId",
              title: "Enter your Cloudflare Account ID",
              placeholder: "e.g. 1234567890abcdef1234567890abcdef",
              required: true,
            },
          ],
        })
      }),
    ),
  )

  it.effect("maps account ID to endpoint URL", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) =>
          catalog.provider.update(Provider.ID.make("cloudflare-workers-ai"), (provider) => {
            provider.package = Provider.aisdk("test-provider")
          }),
        )
        yield* addPlugin()
        expect(
          (yield* (yield* Integration.Service).get(Integration.ID.make("cloudflare-workers-ai")))?.methods,
        ).toContainEqual({ type: "key", label: "API key" })
        const provider = required(yield* catalog.provider.get(Provider.ID.make("cloudflare-workers-ai")))
        expect(provider).toMatchObject({
          package: "aisdk:test-provider",
          settings: { baseURL: "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1" },
        })
      }),
    ),
  )

  it.effect("preserves a configured endpoint URL instead of deriving one from account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) =>
          catalog.provider.update(Provider.ID.make("cloudflare-workers-ai"), (provider) => {
            provider.package = Provider.aisdk("test-provider")
            provider.settings = { ...provider.settings, baseURL: "https://proxy.example/v1" }
          }),
        )
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.make("cloudflare-workers-ai")))).toMatchObject({
          package: "aisdk:test-provider",
          settings: { baseURL: "https://proxy.example/v1" },
        })
      }),
    ),
  )
})
