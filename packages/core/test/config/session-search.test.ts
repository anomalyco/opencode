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
  it.live("starts the build once the location's config turns sqlite_fts on", () => {
    const starts = { count: 0 }
    const build = Layer.succeed(
      SessionSearchBuild.Service,
      SessionSearchBuild.Service.of({
        start: Effect.sync(() => starts.count++),
        run: Effect.void,
      }),
    )
    return Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* config.setEntries(documents(false))
      yield* ConfigSessionSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
      expect(starts.count).toBe(0)

      yield* config.setEntries(documents(true))
      yield* bus.publish(Event.Updated, {})
      const deadline = Date.now() + 10_000
      while (starts.count === 0 && Date.now() < deadline) yield* Effect.sleep("10 millis")
      expect(starts.count).toBeGreaterThan(0)
    }).pipe(Effect.scoped, Effect.provide(build), Effect.provide(PluginTestLayer))
  })

  it.live("starts the build immediately when sqlite_fts is already on at load", () => {
    const starts = { count: 0 }
    const build = Layer.succeed(
      SessionSearchBuild.Service,
      SessionSearchBuild.Service.of({
        start: Effect.sync(() => starts.count++),
        run: Effect.void,
      }),
    )
    return Effect.gen(function* () {
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* config.setEntries(documents(true))
      yield* ConfigSessionSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
      expect(starts.count).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(build), Effect.provide(PluginTestLayer))
  })
})
