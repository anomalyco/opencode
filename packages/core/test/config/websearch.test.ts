import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigWebSearchPlugin } from "@opencode/core/config/plugin/websearch"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { WebSearch } from "@opencode/core/websearch"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigWebSearch } from "@opencode/schema/config/websearch"
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

  it.live("applies per-provider endpoint and key settings", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const seen: (WebSearch.Settings | undefined)[] = []
      yield* websearch.transform((editor) =>
        editor.add({
          id: WebSearch.ID.make("exa"),
          name: "Exa",
          execute: (_input, settings) =>
            Effect.sync(() => {
              seen.push(settings)
              return []
            }),
        }),
      )
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      yield* config.setEntries([
        configured(
          new ConfigWebSearch.Info({
            provider: WebSearch.ID.make("exa"),
            providers: {
              [WebSearch.ID.make("exa")]: {
                endpoint: "https://search.example.com/v1/exa/search",
                apiKey: "proxy-secret",
              },
            },
          }),
        ),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          yield* websearch.query({ query: "apply", providerID: WebSearch.ID.make("exa") })
          return seen.at(-1)?.endpoint === "https://search.example.com/v1/exa/search"
        }).pipe(Effect.orElseSucceed(() => false)),
      )
      expect(seen.at(-1)).toEqual({
        endpoint: "https://search.example.com/v1/exa/search",
        apiKey: "proxy-secret",
      })
    }).pipe(Effect.provide(Config.testLayer([configured(false)]))),
  )

  it.live("keeps provider settings when a higher-priority document only selects a provider", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const seen: (WebSearch.Settings | undefined)[] = []
      yield* websearch.transform((editor) =>
        editor.add({
          id: WebSearch.ID.make("exa"),
          name: "Exa",
          execute: (_input, settings) =>
            Effect.sync(() => {
              seen.push(settings)
              return []
            }),
        }),
      )
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      yield* config.setEntries([
        configured(
          new ConfigWebSearch.Info({
            providers: { [WebSearch.ID.make("exa")]: { endpoint: "https://managed.example.com/exa" } },
          }),
        ),
        configured(new ConfigWebSearch.Info({ provider: "random" })),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          yield* websearch.query({ query: "merge", providerID: WebSearch.ID.make("exa") })
          return seen.at(-1)?.endpoint === "https://managed.example.com/exa"
        }).pipe(Effect.orElseSucceed(() => false)),
      )
      expect(seen.at(-1)).toEqual({ endpoint: "https://managed.example.com/exa" })
    }).pipe(Effect.provide(Config.testLayer([configured(false)]))),
  )

  it.live("keeps a lower-priority selection when a higher-priority document only adds settings", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const seen: (WebSearch.Settings | undefined)[] = []
      yield* websearch.transform((editor) =>
        editor.add({
          id: WebSearch.ID.make("exa"),
          name: "Exa",
          execute: (_input, settings) =>
            Effect.sync(() => {
              seen.push(settings)
              return []
            }),
        }),
      )
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      yield* config.setEntries([
        configured(new ConfigWebSearch.Info({ provider: WebSearch.ID.make("exa") })),
        configured(new ConfigWebSearch.Info({ providers: { [WebSearch.ID.make("exa")]: { apiKey: "user-key" } } })),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          yield* websearch.query({ query: "merge", providerID: WebSearch.ID.make("exa") })
          const provider = yield* websearch.default()
          return provider?.id === WebSearch.ID.make("exa") && seen.at(-1)?.apiKey === "user-key"
        }).pipe(Effect.orElseSucceed(() => false)),
      )
      expect(seen.at(-1)).toEqual({ apiKey: "user-key" })
      expect((yield* websearch.default())?.id).toBe(WebSearch.ID.make("exa"))
    }).pipe(Effect.provide(Config.testLayer([]))),
  )

  it.live("keeps a lower-priority disable when a higher-priority document only adds settings", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      yield* config.setEntries([
        configured(false),
        configured(
          new ConfigWebSearch.Info({
            providers: { [WebSearch.ID.make("exa")]: { endpoint: "https://user.example.com/exa" } },
          }),
        ),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        websearch.default().pipe(
          Effect.as(false),
          Effect.orElseSucceed(() => true),
        ),
      )
      expect((yield* websearch.default().pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")
    }).pipe(Effect.provide(Config.testLayer([]))),
  )
})

function configured(websearch: ConfigWebSearch.Selection): Document {
  return new Document({ type: "document", info: new Info({ websearch }) })
}
