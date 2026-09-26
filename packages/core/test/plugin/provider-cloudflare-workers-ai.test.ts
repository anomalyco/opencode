import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { CloudflareWorkersAIPlugin } from "@opencode/core/plugin/provider/cloudflare-workers-ai"
import { Provider } from "@opencode/core/provider"
import { Integration } from "@opencode/core/integration"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("cloudflare-workers-ai")

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

const seed = Effect.fn(function* (fn: (provider: Provider.MutableInfo) => void) {
  const catalog = yield* Provider.Service
  yield* catalog.transform((catalog) => catalog.update(providerID, fn))
  return catalog
})

describe("CloudflareWorkersAIPlugin", () => {
  it.effect("registers an account form when the environment does not provide one", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("cloudflare-workers-ai")))?.methods).toContainEqual({
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

  it.effect("routes the OpenAI-compatible package to the native Workers AI package", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_KEY: "key" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.package = "@opencode/ai/providers/cloudflare-workers-ai"
        })
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("cloudflare-workers-ai")))?.methods).toContainEqual({
          type: "key",
          label: "API key",
        })
        expect(required(yield* catalog.get(providerID)).package).toBe(
          "@opencode/ai/providers/cloudflare-workers-ai",
        )
      }),
    ),
  )

  it.effect("gives the native Workers AI package its account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.package = "@opencode/ai/providers/cloudflare-workers-ai"
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(providerID)).settings).toEqual({ accountId: "acct" })
      }),
    ),
  )

  it.effect("preserves a configured endpoint URL instead of deriving one from account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "acct" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.package = Provider.aisdk("test-provider")
          provider.settings = { ...provider.settings, baseURL: "https://proxy.example/v1" }
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(providerID))).toMatchObject({
          package: "aisdk:test-provider",
          settings: { baseURL: "https://proxy.example/v1" },
        })
      }),
    ),
  )

  it.effect("uses env account ID over configured account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "env-acct" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.package = Provider.aisdk("test-provider")
          provider.settings = { ...provider.settings, accountId: "configured-acct" }
        })
        yield* addPlugin()
        expect(required(yield* catalog.get(providerID))).toMatchObject({
          package: "aisdk:test-provider",
          settings: { baseURL: "https://api.cloudflare.com/client/v4/accounts/env-acct/ai/v1" },
        })
      }),
    ),
  )
})
