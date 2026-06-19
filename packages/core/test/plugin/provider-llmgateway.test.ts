import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { LLMGatewayPlugin } from "@opencode-ai/core/plugin/provider/llmgateway"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("LLMGatewayPlugin", () => {
  const add = Effect.fnUntraced(function* (plugin: PluginV2.Interface) {
    const integrations = yield* Integration.Service
    yield* plugin.add({
      ...LLMGatewayPlugin,
      effect: LLMGatewayPlugin.effect.pipe(Effect.provideService(Integration.Service, integrations)),
    })
  })

  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() =>
      expectPluginRegistered(
        ProviderPlugins.map((item) => item.id),
        "llmgateway",
      ),
    ),
  )

  it.effect("applies legacy referer headers only to enabled llmgateway", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* add(plugin)
      const integrations = yield* Integration.Service
      yield* integrations.update((editor) => {
        editor.update(Integration.ID.make("llmgateway"), () => {})
        editor.update(Integration.ID.make("openrouter"), () => {})
      })
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const llmgateway = provider("llmgateway", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
          request: { headers: { Existing: "value" }, body: {} },
        })
        catalog.provider.update(llmgateway.id, (draft) => {
          draft.api = llmgateway.api
          draft.request = llmgateway.request
        })
        catalog.provider.update(ProviderV2.ID.openrouter, () => {})
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("llmgateway"))).request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
        "X-Source": "opencode",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter)).request.headers).toEqual({})
    }),
  )

  it.effect("does not apply legacy headers to a disabled llmgateway provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* add(plugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("llmgateway", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("llmgateway"))).disabled).toBeUndefined()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("llmgateway"))).request.headers).toEqual({})
    }),
  )
})
