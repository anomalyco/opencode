export * as PluginInternal from "./internal"

import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
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
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { PluginRuntime } from "../plugin/runtime"
import { PermissionV2 } from "../permission"
import { Reference } from "../reference"
import { Shell } from "../shell"
import { SkillV2 } from "../skill"
import { State } from "../state"
import { ToolRegistry } from "../tool/registry"
import { Tools } from "../tool/tools"
import { HttpClient } from "effect/unstable/http"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { SdkPlugins } from "./sdk"
import { SkillPlugin } from "./skill"
import { VariantPlugin } from "./variant"
import { ShellTool } from "../tool/shell"
import { SubagentTool } from "../tool/subagent"

export type Requirements =
  | AgentV2.Service
  | Catalog.Service
  | CommandV2.Service
  | Config.Service
  | EventV2.Service
  | FileSystem.Service
  | FSUtil.Service
  | Global.Service
  | HttpClient.HttpClient
  | Integration.Service
  | Location.Service
  | LocationMutation.Service
  | ModelsDev.Service
  | Npm.Service
  | PermissionV2.Service
  | PluginRuntime.Service
  | Reference.Service
  | Shell.Service
  | SkillV2.Service
  | Tools.Service

export interface Plugin<R = never> {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R | Scope.Scope>
}

export function define<R>(plugin: Plugin<R>) {
  return plugin
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const commands = yield* CommandV2.Service
    const plugin = yield* PluginV2.Service
    const sdkPlugins = yield* SdkPlugins.Service
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
    const http = yield* HttpClient.HttpClient
    const mutation = yield* LocationMutation.Service
    const permission = yield* PermissionV2.Service
    const skill = yield* SkillV2.Service
    const reference = yield* Reference.Service
    const shell = yield* Shell.Service
    const tools = yield* Tools.Service
    const runtime = yield* PluginRuntime.Service
    const add = <R>(input: Plugin<R>) => {
      const loaded = {
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
              Effect.provideService(HttpClient.HttpClient, http),
              Effect.provideService(LocationMutation.Service, mutation),
              Effect.provideService(PermissionV2.Service, permission),
              Effect.provideService(SkillV2.Service, skill),
              Effect.provideService(Reference.Service, reference),
              Effect.provideService(Shell.Service, shell),
              Effect.provideService(Tools.Service, tools),
              Effect.provideService(PluginRuntime.Service, runtime),
            ),
      }
      return plugin.add(PluginV2.ID.make(loaded.id), loaded.effect)
    }

    yield* State.batch(
      Effect.gen(function* () {
        yield* add(ConfigReferencePlugin.Plugin)
        yield* add(AgentPlugin.Plugin)
        yield* add(CommandPlugin.Plugin)
        yield* add(SkillPlugin.Plugin)
        yield* add(ModelsDevPlugin)
        yield* add(ConfigExternalPlugin.Plugin)
        yield* add(ShellTool.Plugin)
        yield* add(SubagentTool.Plugin)
        yield* add(ConfigAgentPlugin.Plugin)
        yield* add(ConfigCommandPlugin.Plugin)
        yield* add(ConfigSkillPlugin.Plugin)
        for (const item of ProviderPlugins) yield* add(item)
        yield* add(ConfigProviderPlugin.Plugin)
        yield* add(VariantPlugin.Plugin)
        // Embedder-contributed plugins are added last so they layer over config.
        for (const plugin of sdkPlugins.all()) yield* add(plugin)
      }),
    ).pipe(Effect.withSpan("PluginInternal.boot"), Effect.forkScoped({ startImmediately: true }))
  }),
)

export const node = makeLocationNode({
  name: "plugin-internal",
  layer,
  deps: [
    Catalog.node,
    CommandV2.node,
    PluginV2.node,
    Integration.node,
    AgentV2.node,
    Config.node,
    Location.node,
    LocationMutation.node,
    ModelsDev.node,
    Npm.node,
    EventV2.node,
    FSUtil.node,
    FileSystem.node,
    Global.node,
    httpClient,
    PermissionV2.node,
    SkillV2.node,
    Reference.node,
    Shell.node,
    ToolRegistry.toolsNode,
    PluginRuntime.node,
    SdkPlugins.node,
  ],
})
