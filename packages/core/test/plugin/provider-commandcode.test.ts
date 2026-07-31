import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { CommandCodePlugin } from "@opencode-ai/core/plugin/provider/commandcode"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* CommandCodePlugin.effect(host)
})

const COMMANDCODE = ProviderV2.ID.make("commandcode")

describe("CommandCodePlugin", () => {
  it.effect("is registered so ZDR headers are enforced", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("commandcode"))),
  )

  it.effect("applies ZDR and referer headers only to commandcode", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(COMMANDCODE, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          provider.request = { headers: { Existing: "value" }, body: {} }
        })
        catalog.provider.update(ProviderV2.ID.make("nvidia"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(COMMANDCODE))?.request.headers).toEqual({
        Existing: "value",
        "X-Title": "opencode",
        "x-cmd-zdr": "1",
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("nvidia")))?.request.headers).toEqual({})
    }),
  )

  it.effect("creates the provider when missing so it shows in pickers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const provider = yield* catalog.provider.get(COMMANDCODE)
      expect(provider?.name).toBe("Command Code")
      expect(provider?.api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://api.commandcode.ai/provider/v1",
      })
      expect(provider?.request.headers).toEqual({
        "X-Title": "opencode",
        "x-cmd-zdr": "1",
      })
    }),
  )

  it.effect("sets anthropic-beta only on Anthropic package models", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(COMMANDCODE, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
        catalog.model.update(COMMANDCODE, ModelV2.ID.make("claude-sonnet-4-6"), (model) => {
          model.api = { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "@ai-sdk/anthropic" }
        })
        catalog.model.update(COMMANDCODE, ModelV2.ID.make("deepseek/deepseek-v4-pro"), () => {})
      })
      yield* addPlugin()

      expect(
        (yield* catalog.model.get(COMMANDCODE, ModelV2.ID.make("claude-sonnet-4-6")))?.request.headers,
      ).toEqual({
        "X-Title": "opencode",
        "x-cmd-zdr": "1",
        "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      })
      expect((yield* catalog.model.get(COMMANDCODE, ModelV2.ID.make("deepseek/deepseek-v4-pro")))?.request.headers)
        .toEqual({ "X-Title": "opencode", "x-cmd-zdr": "1" })
    }),
  )
})
