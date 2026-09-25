import path from "path"
import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigExternalPlugin } from "@opencode-ai/core/config/plugin/external"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { Npm } from "@opencode-ai/core/npm"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Exit, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)
const delayedPlugin = path.join(import.meta.dir, "fixture/delayed-catalog-plugin.ts")
const hangingPlugin = path.join(import.meta.dir, "fixture/hanging-catalog-plugin.ts")

describe("catalog readiness", () => {
  it.live("catalog reads wait for a delayed plugin before returning providers and models", () =>
    Effect.gen(function* () {
      yield* loadConfiguredPlugins([delayedPlugin])
      const catalog = yield* Catalog.Service
      const providers = yield* catalog.provider.available()
      const models = yield* catalog.model.available()

      expect(providers.some((provider) => provider.id === ProviderV2.ID.make("delayed-provider"))).toBe(true)
      expect(
        models.some(
          (model) =>
            model.providerID === ProviderV2.ID.make("delayed-provider") && model.id === ModelV2.ID.make("delayed-model"),
        ),
      ).toBe(true)
    }),
  )

  it.live("catalog readiness stays pending while a plugin never activates", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* loadConfiguredPlugins([hangingPlugin]).pipe(Effect.forkChild)
      yield* Effect.sleep("50 millis")
      const result = yield* catalog.ready.pipe(Effect.timeout("500 millis"), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }),
  )
})

function loadConfiguredPlugins(plugins: string[]) {
  return Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const npm = yield* Npm.Service
    const host = yield* PluginHost.make(plugin)
    yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
      Effect.provideService(PluginV2.Service, plugin),
      Effect.provideService(FSUtil.Service, fs),
      Effect.provideService(Location.Service, location),
      Effect.provideService(Npm.Service, npm),
      Effect.provideService(
        Config.Service,
        Config.Service.of({
          entries: () =>
            Effect.succeed([
              new Config.Document({
                type: "document",
                path: path.join(import.meta.dir, "config/opencode.json"),
                info: decode({ plugins }),
              }),
            ]),
        }),
      ),
    )
  })
}
