import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it } from "../plugin/provider-helper"

function request(headers: Record<string, string>, variant?: string) {
  return {
    headers,
    variant,
  }
}

const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("loads configured providers and applies later model overrides", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const providerID = ProviderV2.ID.make("custom")
      const modelID = ModelV2.ID.make("chat")
      const config = Config.Service.of({
        directories: () => Effect.succeed([]),
        get: () =>
          Effect.succeed([
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                providers: {
                  custom: {
                    name: "Configured",
                    env: ["CUSTOM_API_KEY"],
                    api: { type: "native", settings: {} },
                    request: request({ first: "first", shared: "first" }),
                    models: {
                      chat: {
                        name: "First",
                        capabilities: { tools: true, input: ["text"], output: ["text"] },
                        disabled: true,
                        limit: { context: 100, output: 50 },
                        cost: { input: 1, output: 2 },
                        request: request({ first: "first", shared: "first" }, "retained"),
                        variants: [
                          {
                            id: "fast",
                            headers: { first: "first", shared: "first" },
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            }),
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                providers: {
                  custom: {
                    api: { type: "aisdk", package: "custom-sdk", url: "https://example.test" },
                    request: request({ last: "last", shared: "last" }),
                    models: {
                      chat: {
                        api_id: "api-chat",
                        name: "Last",
                        limit: { output: 75 },
                        request: request({ last: "last", shared: "last" }),
                        variants: [
                          {
                            id: "fast",
                            headers: { last: "last", shared: "last" },
                          },
                          {
                            id: "slow",
                            headers: { slow: "slow" },
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            }),
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                providers: {
                  custom: { name: "Renamed" },
                },
              }),
            }),
          ]),
      })

      yield* plugin.add({
        ...ConfigProviderPlugin.Plugin,
        effect: ConfigProviderPlugin.Plugin.effect.pipe(
          Effect.provideService(Config.Service, config),
          Effect.provideService(Catalog.Service, catalog),
        ),
      })

      const provider = yield* catalog.provider.get(providerID)
      const model = yield* catalog.model.get(providerID, modelID)
      expect(provider.name).toBe("Renamed")
      expect(provider.env).toEqual(["CUSTOM_API_KEY"])
      expect(provider.enabled).toEqual({ via: "custom", data: {} })
      expect(provider.api).toEqual({ type: "aisdk", package: "custom-sdk", url: "https://example.test" })
      expect(provider.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
      expect(model.apiID).toBe(ModelV2.ID.make("api-chat"))
      expect(model.name).toBe("Last")
      expect(model.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
      expect(model.enabled).toBe(false)
      expect(model.limit).toEqual({ context: 100, output: 75 })
      expect(model.cost).toEqual([{ input: 1, output: 2, cache: { read: 0, write: 0 }, tier: undefined }])
      expect(model.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
      expect(model.request.variant).toBe("retained")
      expect(model.variants.map((variant) => variant.id)).toEqual([
        ModelV2.VariantID.make("fast"),
        ModelV2.VariantID.make("slow"),
      ])
      expect(model.variants[0]?.headers).toEqual({ first: "first", shared: "last", last: "last" })
      expect(model.variants[1]?.headers).toEqual({ slow: "slow" })
    }),
  )
})
