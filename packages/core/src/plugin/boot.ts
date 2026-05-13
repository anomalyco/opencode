export * as PluginBoot from "./boot"

import { Effect, Layer } from "effect"
import { AuthV2 } from "../auth"
import { Catalog } from "../catalog"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { AuthPlugin } from "./auth"
import { EnvPlugin } from "./env"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"

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
