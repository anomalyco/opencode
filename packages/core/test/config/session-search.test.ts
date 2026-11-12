import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigSessionSearchPlugin } from "@opencode/core/config/plugin/session-search"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { SessionSearchBuild } from "@opencode/core/session/search-build"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const documents = (on: boolean) => [
  new Document({ type: "document", info: new Info({ experimental: new ConfigExperimental.Info({ sqlite_fts: on }) }) }),
]

describe("ConfigSessionSearchPlugin.Plugin", () => {
  it.live("holds the build while the location's config turns sqlite_fts on", () => {
    const holds = { count: 0 }
    const build = Layer.succeed(
      SessionSearchBuild.Service,
      SessionSearchBuild.Service.of({
        hold: Effect.acquireRelease(
          Effect.sync(() => holds.count++),
          () => Effect.sync(() => holds.count--),
        ).pipe(Effect.asVoid),
        status: Effect.succeed({ status: "disabled" }),
      }),
    )
    const until = (count: number) =>
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 200 && holds.count !== count; attempt++) yield* Effect.sleep("10 millis")
        expect(holds.count).toBe(count)
      })
    return Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* config.setEntries(documents(false))
      yield* ConfigSessionSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
      expect(holds.count).toBe(0)

      yield* config.setEntries(documents(true))
      yield* bus.publish(Event.Updated, {})
      yield* until(1)

      yield* config.setEntries(documents(false))
      yield* bus.publish(Event.Updated, {})
      yield* until(0)
    }).pipe(Effect.scoped, Effect.provide(build), Effect.provide(PluginTestLayer))
  })
})
