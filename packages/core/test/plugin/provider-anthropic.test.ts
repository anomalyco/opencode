import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AnthropicPlugin } from "@opencode-ai/core/plugin/provider/anthropic"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AnthropicPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("AnthropicPlugin", () => {
  it.effect("applies legacy beta headers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const item = Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.anthropic),
          package: Provider.aisdk("@ai-sdk/anthropic"),
          headers: { Existing: "1" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.package = item.package
          draft.headers = { Existing: "1" }
        })
      })
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(Provider.ID.anthropic)).headers?.["anthropic-beta"]).toBe(
        "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      )
      expect(required(yield* catalog.provider.get(Provider.ID.anthropic)).headers?.Existing).toBe("1")
    }),
  )

  it.effect("ignores non-Anthropic providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(Provider.ID.openai, () => {}))
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(Provider.ID.openai)).headers?.["anthropic-beta"]).toBeUndefined()
    }),
  )
})
