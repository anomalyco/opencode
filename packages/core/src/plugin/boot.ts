export * as PluginBoot from "./boot"

import type { Plugin as PublicPlugin } from "@opencode-ai/plugin/v2/effect"
import { Context, Deferred, Effect, Layer } from "effect"
import { Integration } from "../integration"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { FileSystem } from "../filesystem"
import { Global } from "../global"
import { Location } from "../location"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { SkillPlugin } from "./skill"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { SkillV2 } from "../skill"
import { Reference } from "../reference"
import { State } from "../state"
import { PluginHost } from "./host"

type InternalPlugin = PublicPlugin<any>

export interface Interface {
  readonly add: (plugin: PublicPlugin<any>) => Effect.Effect<void>
  readonly wait: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginBoot") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const commands = yield* CommandV2.Service
    const plugin = yield* PluginV2.Service
    const integration = yield* Integration.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const modelsDev = yield* ModelsDev.Service
    const npm = yield* Npm.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const filesystem = yield* FileSystem.Service
    const global = yield* Global.Service
    const skill = yield* SkillV2.Service
    const reference = yield* Reference.Service
    const host = yield* PluginHost.make()
    const done = yield* Deferred.make<void>()

    const add = Effect.fn("PluginBoot.add")(function* (input: InternalPlugin) {
      yield* plugin.add({
        id: input.id,
        effect: input
          .effect(host)
          .pipe(
            Effect.provideService(Catalog.Service, catalog),
            Effect.provideService(CommandV2.Service, commands),
            Effect.provideService(Integration.Service, integration),
            Effect.provideService(AgentV2.Service, agents),
            Effect.provideService(Config.Service, config),
            Effect.provideService(Location.Service, location),
            Effect.provideService(ModelsDev.Service, modelsDev),
            Effect.provideService(Npm.Service, npm),
            Effect.provideService(EventV2.Service, events),
            Effect.provideService(FSUtil.Service, fs),
            Effect.provideService(FileSystem.Service, filesystem),
            Effect.provideService(Global.Service, global),
            Effect.provideService(SkillV2.Service, skill),
            Effect.provideService(Reference.Service, reference),
          ),
      })
    })

    const boot = Effect.gen(function* () {
      yield* State.batch(
        Effect.gen(function* () {
          yield* add(AgentPlugin.Plugin)
          yield* add(CommandPlugin.Plugin)
          yield* add(SkillPlugin.Plugin)
          yield* add(ModelsDevPlugin)
          yield* add(ConfigProviderPlugin.Plugin)
          yield* add(ConfigAgentPlugin.Plugin)
          yield* add(ConfigCommandPlugin.Plugin)
          yield* add(ConfigSkillPlugin.Plugin)
          yield* add(ConfigReferencePlugin.Plugin)
          for (const item of ProviderPlugins) {
            yield* add(item)
          }
        }),
      )
    }).pipe(Effect.withSpan("PluginBoot.boot"))

    yield* boot.pipe(
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(done, exit)),
      Effect.forkScoped,
    )

    return Service.of({
      add: (input) =>
        Deferred.await(done).pipe(
          Effect.andThen(
            plugin.add({
              id: input.id,
              effect: input.effect(host),
            }),
          ),
        ),
      wait: () => Deferred.await(done),
    })
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(PluginV2.locationLayer),
  Layer.provideMerge(Integration.locationLayer),
  Layer.provideMerge(Catalog.locationLayer),
  Layer.provideMerge(CommandV2.locationLayer),
  Layer.provideMerge(Config.locationLayer),
  Layer.provideMerge(AgentV2.locationLayer),
  Layer.provideMerge(SkillV2.locationLayer),
  Layer.provideMerge(Reference.locationLayer),
  Layer.provideMerge(FileSystem.locationLayer),
)
