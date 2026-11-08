import { describe, expect } from "bun:test"
import { Bus } from "@Mackery6969/core/bus"
import { Config } from "@Mackery6969/core/config"
import { ConfigWebSearchPlugin } from "@Mackery6969/core/config/plugin/websearch"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHost } from "@Mackery6969/core/plugin/host"
import { WebSearch } from "@Mackery6969/core/websearch"
import { Document, Event, Info } from "@Mackery6969/schema/config"
import { ConfigWebSearch } from "@Mackery6969/schema/config/websearch"
import { Effect } from "effect"
import { waitUntil } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

describe("ConfigWebSearchPlugin.Plugin", () => {
  it.live("reloads changed default selection", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* websearch.transform((editor) =>
        editor.add({ id: WebSearch.ID.make("test"), name: "Test", execute: () => Effect.succeed([]) }),
      )
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      expect((yield* websearch.default().pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")

      yield* config.setEntries([configured(new ConfigWebSearch.Info({ provider: "random" }))])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        websearch.default().pipe(
          Effect.map((provider) => provider?.id === WebSearch.ID.make("test")),
          Effect.orElseSucceed(() => false),
        ),
      )
    }).pipe(Effect.provide(Config.testLayer([configured(false)]))),
  )
})

function configured(websearch: ConfigWebSearch.Selection): Document {
  return new Document({ type: "document", info: new Info({ websearch }) })
}
