import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { AgionePlugin } from "@opencode-ai/core/plugin/provider/agione"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { expectPluginRegistered, npmLayer, withEnv } from "./provider-helper"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)

const it = testEffect(
  Catalog.locationLayer.pipe(
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(locationLayer),
    Layer.provideMerge(npmLayer),
  ),
)

describe("AgionePlugin", () => {
  it.effect("is registered as a provider plugin", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "agione",
      ),
    ),
  )

  it.effect("adds the AGIone provider and default coding model", () =>
    withEnv({ AGIONE_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AgionePlugin)
        const transform = yield* catalog.transform()
        yield* transform(() => {})

        const provider = yield* catalog.provider.get(ProviderV2.ID.make("agione"))
        expect(provider.name).toBe("AGIone")
        expect(provider.env).toEqual(["AGIONE_API_KEY"])
        expect(provider.api).toEqual({
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://agione.pro/hyperone/xapi/api/v1",
        })
        expect(provider.request.headers).toEqual({
          "HTTP-Referer": "https://opencode.ai/",
          "X-Title": "opencode",
        })
        expect(provider.enabled).toBe(false)

        const model = yield* catalog.model.get(
          ProviderV2.ID.make("agione"),
          ModelV2.ID.make("deepseek/deepseek-v4-pro/d3462"),
        )
        expect(model.name).toBe("DeepSeek V4 Pro")
        expect(model.api).toEqual({
          id: ModelV2.ID.make("deepseek/deepseek-v4-pro/d3462"),
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://agione.pro/hyperone/xapi/api/v1",
          settings: {},
        })
        expect(model.capabilities).toEqual({
          tools: true,
          input: ["text"],
          output: ["text"],
        })
        expect(model.limit).toEqual({ context: 128_000, output: 8_192 })
      }),
    ),
  )

  it.effect("enables AGIone from AGIONE_API_KEY", () =>
    withEnv({ AGIONE_API_KEY: "test-key" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(AgionePlugin)
        const transform = yield* catalog.transform()
        yield* transform(() => {})

        const provider = yield* catalog.provider.get(ProviderV2.ID.make("agione"))
        expect(provider.enabled).toEqual({ via: "env", name: "AGIONE_API_KEY" })
      }),
    ),
  )
})
