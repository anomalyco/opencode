export * as PluginBoot from "./plugin-boot"

import { Npm } from "@opencode-ai/core/npm"
import { Effect, Layer } from "effect"
import { AuthV2 } from "@opencode-ai/core/auth"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AuthPlugin } from "@opencode-ai/core/plugin/auth"
import { EnvPlugin } from "@opencode-ai/core/plugin/env"
import { ModelsDevPlugin } from "./plugin/models-dev"
import { ProviderPlugins } from "./plugin/provider"

type Plugin = {
  id: PluginV2.ID
  effect: Effect.Effect<PluginV2.HookFunctions | void, never, Catalog.Service | AuthV2.Service | Npm.Service>
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const plugin = yield* PluginV2.Service
    const auth = yield* AuthV2.Service
    const npm = yield* Npm.Service

    const add = Effect.fn("PluginBoot.add")(function* (input: Plugin) {
      yield* plugin.add({
        id: input.id,
        effect: input.effect.pipe(
          Effect.provideService(Catalog.Service, catalog),
          Effect.provideService(AuthV2.Service, auth),
          Effect.provideService(Npm.Service, npm),
        ),
      })
    })

    yield* add(EnvPlugin)
    yield* add(AuthPlugin)
    for (const item of ProviderPlugins) {
      yield* add(item)
    }
    yield* add(ModelsDevPlugin)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Catalog.defaultLayer),
  Layer.provide(PluginV2.defaultLayer),
  Layer.provide(Layer.orDie(AuthV2.defaultLayer)),
  Layer.provide(Npm.defaultLayer),
)
