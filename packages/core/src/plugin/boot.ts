export * as PluginBoot from "./boot"

import { Context, Deferred, Effect, Layer } from "effect"
import { Auth } from "../auth"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { EventV2 } from "../event"
import { Location } from "../location"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { AccountPlugin } from "./account"
import { AgentPlugin } from "./agent"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { EnvPlugin } from "./env"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"

type Plugin = {
  id: PluginV2.ID
  effect: PluginV2.Effect<
    | Catalog.Service
    | Auth.Service
    | AgentV2.Service
    | Npm.Service
    | EventV2.Service
    | Location.Service
    | PluginV2.Service
    | Config.Service
    | ModelsDev.Service
  >
}

export interface Interface {
  readonly wait: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginBoot") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const plugin = yield* PluginV2.Service
    const accounts = yield* Auth.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const modelsDev = yield* ModelsDev.Service
    const npm = yield* Npm.Service
    const events = yield* EventV2.Service
    const done = yield* Deferred.make<void>()

    const add = Effect.fn("PluginBoot.add")(function* (input: Plugin) {
      yield* plugin.add({
        id: input.id,
        effect: input.effect.pipe(
          Effect.provideService(Catalog.Service, catalog),
          Effect.provideService(Auth.Service, accounts),
          Effect.provideService(AgentV2.Service, agents),
          Effect.provideService(Config.Service, config),
          Effect.provideService(Location.Service, location),
          Effect.provideService(ModelsDev.Service, modelsDev),
          Effect.provideService(Npm.Service, npm),
          Effect.provideService(EventV2.Service, events),
          Effect.provideService(PluginV2.Service, plugin),
        ),
      })
    })

    const boot = Effect.gen(function* () {
      yield* add(EnvPlugin)
      yield* add(AccountPlugin)
      yield* add(AgentPlugin.Plugin)
      for (const item of ProviderPlugins) {
        yield* add(item)
      }
      yield* add(ModelsDevPlugin)
      yield* add(ConfigProviderPlugin.Plugin)
      yield* add(ConfigAgentPlugin.Plugin)
    }).pipe(Effect.withSpan("PluginBoot.boot"))

    yield* boot.pipe(
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(done, exit)),
      Effect.forkScoped,
    )

    return Service.of({
      wait: () => Deferred.await(done),
    })
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(Catalog.locationLayer),
  Layer.provideMerge(Config.locationLayer),
  Layer.provideMerge(AgentV2.locationLayer),
)
