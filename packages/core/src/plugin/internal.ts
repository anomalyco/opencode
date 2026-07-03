export * as PluginInternal from "./internal"

import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { Context, Effect, Layer, Scope } from "effect"
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
import { Ripgrep } from "../ripgrep"
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
import { GlobTool } from "../tool/glob"
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
  | Ripgrep.Service
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
    const plugin = yield* PluginV2.Service
    const sdkPlugins = yield* SdkPlugins.Service
    const services = Context.mergeAll(
      Context.make(Catalog.Service, yield* Catalog.Service),
      Context.make(CommandV2.Service, yield* CommandV2.Service),
      Context.make(Integration.Service, yield* Integration.Service),
      Context.make(AgentV2.Service, yield* AgentV2.Service),
      Context.make(Config.Service, yield* Config.Service),
      Context.make(Location.Service, yield* Location.Service),
      Context.make(ModelsDev.Service, yield* ModelsDev.Service),
      Context.make(Npm.Service, yield* Npm.Service),
      Context.make(EventV2.Service, yield* EventV2.Service),
      Context.make(FSUtil.Service, yield* FSUtil.Service),
      Context.make(FileSystem.Service, yield* FileSystem.Service),
      Context.make(Global.Service, yield* Global.Service),
      Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient),
      Context.make(LocationMutation.Service, yield* LocationMutation.Service),
      Context.make(PermissionV2.Service, yield* PermissionV2.Service),
      Context.make(SkillV2.Service, yield* SkillV2.Service),
      Context.make(Reference.Service, yield* Reference.Service),
      Context.make(Ripgrep.Service, yield* Ripgrep.Service),
      Context.make(Shell.Service, yield* Shell.Service),
      Context.make(Tools.Service, yield* Tools.Service),
      Context.make(PluginRuntime.Service, yield* PluginRuntime.Service),
    )
    const add = (input: Plugin<Requirements | Scope.Scope>) =>
      plugin.add(PluginV2.ID.make(input.id), (context: PluginContext) =>
        input.effect(context).pipe(Effect.provide(services)),
      )

    yield* State.batch(
      Effect.gen(function* () {
        yield* add(ConfigReferencePlugin.Plugin)
        yield* add(AgentPlugin.Plugin)
        yield* add(CommandPlugin.Plugin)
        yield* add(SkillPlugin.Plugin)
        yield* add(ModelsDevPlugin)
        yield* add(ConfigExternalPlugin.Plugin)
        yield* add(GlobTool.Plugin)
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
    Ripgrep.node,
    Shell.node,
    ToolRegistry.toolsNode,
    PluginRuntime.node,
    SdkPlugins.node,
  ],
})
