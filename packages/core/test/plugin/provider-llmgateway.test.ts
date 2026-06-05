import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { LLMGatewayPlugin } from "@opencode-ai/core/plugin/provider/llmgateway"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expectPluginRegistered, it, provider } from "./provider-helper"

describe("LLMGatewayPlugin", () => {
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
      yield* plugin.add(LLMGatewayPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const llmgateway = provider("llmgateway", {
          enabled: { via: "env", name: "LLMGATEWAY_API_KEY" },
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
          request: { headers: { Existing: "value" }, body: {} },
        })
        catalog.provider.update(llmgateway.id, (draft) => {
          draft.enabled = llmgateway.enabled
          draft.api = llmgateway.api
          draft.request = llmgateway.request
        })
        const openrouter = provider("openrouter", {
          enabled: { via: "env", name: "OPENROUTER_API_KEY" },
        })
        catalog.provider.update(openrouter.id, (draft) => {
          draft.enabled = openrouter.enabled
        })
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
      yield* plugin.add(LLMGatewayPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const item = provider("llmgateway", {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
      })

      expect((yield* catalog.provider.get(ProviderV2.ID.make("llmgateway"))).enabled).toBe(false)
      expect((yield* catalog.provider.get(ProviderV2.ID.make("llmgateway"))).request.headers).toEqual({})
    }),
  )
})
