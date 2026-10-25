import { AISDK } from "@bolt-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@bolt-ai/core/model"
import { PluginV2 } from "@bolt-ai/core/plugin"
import { PluginHost } from "@bolt-ai/core/plugin/host"
import { CloudflareAIGatewayPlugin } from "@bolt-ai/core/plugin/provider/cloudflare-ai-gateway"
import { ProviderV2 } from "@bolt-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("cloudflare-ai-gateway")

const seed = Effect.fn(function* (fn: (provider: Provider.MutableInfo) => void) {
  const catalog = yield* Provider.Service
  yield* catalog.transform((catalog) => catalog.update(providerID, fn))
  return catalog
})

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* CloudflareAIGatewayPlugin.effect(host)
})

describe("CloudflareAIGatewayPlugin", () => {
  it.effect("registers account and gateway forms when the environment does not provide them", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_GATEWAY_ID: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: {
            name: "cloudflare-ai-gateway",
            metadata: { invoked_by: "test", project: "bolt" },
            cacheTtl: 300,
            cacheKey: "cache-key",
            skipCache: true,
            collectLog: false,
          },
        })

        expect(aiGatewayCalls).toHaveLength(1)
        expect(aiGatewayCalls[0]).toEqual({
          accountId: "env-account",
          gateway: "env-gateway",
          apiKey: "env-token",
          options: {
            metadata: { invoked_by: "test", project: "bolt" },
            cacheTtl: 300,
            cacheKey: "cache-key",
            skipCache: true,
            collectLog: false,
            headers: {
              "User-Agent": expect.stringContaining("bolt/"),
            },
          },
        })
      }),
    ),
  )

  it.effect("uses environment account and gateway values without requesting form fields", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: {
            name: "cloudflare-ai-gateway",
            headers: {
              "cf-aig-metadata": JSON.stringify({ invoked_by: "header", project: "bolt" }),
            },
          },
        })

        expect(aiGatewayCalls[0]?.options).toMatchObject({
          metadata: { invoked_by: "header", project: "bolt" },
        })
      }),
    ),
  )

  it.effect("requests only the gateway ID when the environment provides the account ID", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("cloudflare-ai-gateway")))?.methods).toContainEqual({
          type: "key",
          label: "Gateway API token",
          form: [expect.objectContaining({ type: "string", key: "gatewayId", required: true })],
        })
      }),
    ),
  )

  it.effect("gives the provider its environment account and gateway IDs", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed(() => {})
        yield* addPlugin()
        expect((yield* catalog.get(providerID))?.settings).toEqual({ accountId: "account", gatewayId: "gateway" })
      }),
    ),
  )

  it.effect("prefers configured IDs over environment IDs", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "env-account", CLOUDFLARE_GATEWAY_ID: "env-gateway" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.settings = { accountId: "configured-account", gatewayId: "configured-gateway" }
        })
        yield* addPlugin()
        expect((yield* catalog.get(providerID))?.settings).toEqual({
          accountId: "configured-account",
          gatewayId: "configured-gateway",
        })
      }),
    ),
  )

  it.effect("leaves a configured endpoint URL untouched", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seed((provider) => {
          provider.settings = { baseURL: "https://proxy.example/v1" }
        })
        yield* addPlugin()
        expect((yield* catalog.get(providerID))?.settings).toEqual({ baseURL: "https://proxy.example/v1" })
      }),
    ),
  )
})
