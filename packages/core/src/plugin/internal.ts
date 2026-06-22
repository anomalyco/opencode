export * as PluginInternal from "./internal"

import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigExternalPlugin } from "../config/plugin/external"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { EventV2 } from "../event"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { Reference } from "../reference"
import { SkillV2 } from "../skill"
import { State } from "../state"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { PluginHost } from "./host"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { SkillPlugin } from "./skill"

export type Requirements =
  | AgentV2.Service
  | Catalog.Service
  | CommandV2.Service
  | Config.Service
  | EventV2.Service
  | FileSystem.Service
  | FSUtil.Service
  | Global.Service
  | Integration.Service
  | Location.Service
  | ModelsDev.Service
  | Npm.Service
  | Reference.Service
  | SkillV2.Service

export interface Plugin<R = never> {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R | Scope.Scope>
}

export function define<R>(plugin: Plugin<R>) {
  return plugin
}

export const locationLayer = Layer.effectDiscard(
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
    const host = yield* PluginHost.make(plugin)

    const wrap = <R>(input: Plugin<R>) => ({
      id: input.id,
      effect: (context: PluginContext) =>
        input
          .effect(context)
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

    yield* State.batch(
      Effect.gen(function* () {
        yield* plugin.transform((plugins) => {
          plugins.add(wrap(AgentPlugin.Plugin))
          plugins.add(wrap(CommandPlugin.Plugin))
          plugins.add(wrap(SkillPlugin.Plugin))
          plugins.add(wrap(ModelsDevPlugin))
          plugins.add(wrap(ConfigProviderPlugin.Plugin))
          plugins.add(wrap(ConfigAgentPlugin.Plugin))
          plugins.add(wrap(ConfigCommandPlugin.Plugin))
          plugins.add(wrap(ConfigSkillPlugin.Plugin))
          plugins.add(wrap(ConfigReferencePlugin.Plugin))
          for (const item of ProviderPlugins) plugins.add(wrap(item))
        })

        yield* wrap(ConfigExternalPlugin.Plugin).effect(host)
      }),
    ).pipe(Effect.withSpan("PluginInternal.boot"), Effect.forkScoped({ startImmediately: true }))
  }),
).pipe(
  Layer.provideMerge(PluginV2.locationLayer),
  Layer.provideMerge(Config.locationLayer),
  Layer.provideMerge(FileSystem.locationLayer),
)
