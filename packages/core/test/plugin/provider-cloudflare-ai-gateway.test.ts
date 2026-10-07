import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { CloudflareAIGatewayPlugin } from "@opencode/core/plugin/provider/cloudflare-ai-gateway"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
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
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("cloudflare-ai-gateway")))?.methods).toContainEqual({
          type: "key",
          label: "Gateway API token",
          form: [
            expect.objectContaining({ type: "string", key: "accountId", required: true }),
            expect.objectContaining({ type: "string", key: "gatewayId", required: true }),
          ],
        })
      }),
    ),
  )

  it.effect("uses environment account and gateway values without requesting form fields", () =>
    withEnv({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(Integration.ID.make("cloudflare-ai-gateway")))?.methods).toContainEqual({
          type: "key",
          label: "Gateway API token",
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
