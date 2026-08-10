export * as PluginInternal from "./internal"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Context, Effect, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Agent } from "../agent"
import { Catalog } from "../catalog"
import { Command } from "../command"
import { Config } from "../config"
import { Credential } from "../credential"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ConfigPolicyPlugin } from "../config/plugin/policy"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch"
import { Bus } from "../bus"
import { Environment } from "../environment"
import { FileMutation } from "../file-mutation"
import { Formatter } from "../formatter"
import { Form } from "../form"
import { FileSystem } from "../filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Image } from "../image"
import { Integration } from "../integration"
import { KV } from "../kv"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "@opencode-ai/util/npm"
import { Permission } from "../permission"
import { Reference } from "../reference"
import { WebSearch } from "../websearch"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { Shell } from "../shell"
import { Skill } from "../skill"
import { SkillDiscovery } from "../skill/discovery"
import { Watcher } from "../filesystem/watcher"
import { PatchTool } from "../tool/plugin/patch"
import { EditTool } from "../tool/plugin/edit"
import { GlobTool } from "../tool/plugin/glob"
import { GrepTool } from "../tool/plugin/grep"
import { QuestionTool } from "../tool/plugin/question"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { ReadTool } from "../tool/plugin/read"
import { ShellTool } from "../tool/plugin/shell"
import { SkillTool } from "../tool/plugin/skill"
import { SubagentTool } from "../tool/plugin/subagent"
import { Tool } from "../tool"
import { WebFetchTool } from "../tool/plugin/webfetch"
import { WebSearchTool } from "../tool/plugin/websearch"
import { WellKnown } from "../wellknown"
import { WriteTool } from "../tool/plugin/write"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { WebSearchPlugins } from "./websearch"
import { PluginRuntime } from "./runtime"
import { SkillPlugin } from "./skill"
import { SystemPromptPlugin } from "./system-prompt"
import { VariantPlugin } from "./variant"
import { WarmingPlugin } from "./warming"
import { WellKnownPlugin } from "../wellknown/plugin"

const services = Effect.fn("PluginInternal.services")(function* () {
  const agent = yield* Agent.Service
  const catalog = yield* Catalog.Service
  const command = yield* Command.Service
  const config = yield* Config.Service
  const credential = yield* Credential.Service
  const bus = yield* Bus.Service
  const environment = yield* Environment.Service
  const mutation = yield* FileMutation.Service
  const formatter = yield* Formatter.Service
  const filesystem = yield* FileSystem.Service
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const http = yield* HttpClient.HttpClient
  const image = yield* Image.Service
  const integration = yield* Integration.Service
  const kv = yield* KV.Service
  const location = yield* Location.Service
  const locationMutation = yield* LocationMutation.Service
  const models = yield* ModelsDev.Service
  const npm = yield* Npm.Service
  const permission = yield* Permission.Service
  const runtime = yield* PluginRuntime.Service
  const form = yield* Form.Service
  const read = yield* ReadToolFileSystem.Service
  const reference = yield* Reference.Service
  const websearch = yield* WebSearch.Service
  const ripgrep = yield* Ripgrep.Service
  const instructions = yield* SessionInstructions.Service
  const shell = yield* Shell.Service
  const skill = yield* Skill.Service
  const skillDiscovery = yield* SkillDiscovery.Service
  const tools = yield* Tool.Service
  const watcher = yield* Watcher.Service
  const wellknown = yield* WellKnown.Service
  return Context.mergeAll(
    Context.make(Agent.Service, agent),
    Context.make(Catalog.Service, catalog),
    Context.make(Command.Service, command),
    Context.make(Config.Service, config),
    Context.make(Credential.Service, credential),
    Context.make(Bus.Service, bus),
    Context.make(Environment.Service, environment),
    Context.make(FileMutation.Service, mutation),
    Context.make(Formatter.Service, formatter),
    Context.make(FileSystem.Service, filesystem),
    Context.make(FSUtil.Service, fs),
    Context.make(Global.Service, global),
    Context.make(HttpClient.HttpClient, http),
    Context.make(Image.Service, image),
    Context.make(Integration.Service, integration),
    Context.make(KV.Service, kv),
    Context.make(Location.Service, location),
    Context.make(LocationMutation.Service, locationMutation),
    Context.make(ModelsDev.Service, models),
    Context.make(Npm.Service, npm),
    Context.make(Permission.Service, permission),
    Context.make(PluginRuntime.Service, runtime),
    Context.make(Form.Service, form),
    Context.make(ReadToolFileSystem.Service, read),
    Context.make(Reference.Service, reference),
    Context.make(WebSearch.Service, websearch),
    Context.make(Ripgrep.Service, ripgrep),
    Context.make(SessionInstructions.Service, instructions),
    Context.make(Shell.Service, shell),
    Context.make(Skill.Service, skill),
    Context.make(SkillDiscovery.Service, skillDiscovery),
    Context.make(Tool.Service, tools),
    Context.make(Watcher.Service, watcher),
    Context.make(WellKnown.Service, wellknown),
  )
})

type ContextServices<A> = A extends Context.Context<infer R> ? R : never

export type Requirements = ContextServices<Effect.Success<ReturnType<typeof services>>>

export const requirements = LayerNode.group([
  Agent.node,
  Catalog.node,
  Command.node,
  Config.node,
  Credential.node,
  Bus.node,
  Environment.node,
  FileMutation.node,
  Formatter.node,
  FileSystem.node,
  FSUtil.node,
  Global.node,
  httpClient,
  Image.node,
  Integration.node,
  KV.node,
  Location.node,
  LocationMutation.node,
  ModelsDev.node,
  Npm.node,
  Permission.node,
  PluginRuntime.node,
  Form.node,
  ReadToolFileSystem.node,
  Reference.node,
  WebSearch.node,
  Ripgrep.node,
  SessionInstructions.node,
  Shell.node,
  Skill.node,
  SkillDiscovery.node,
  Tool.node,
  Watcher.node,
  WellKnown.node,
])

export type InternalPlugin = Plugin<Requirements | Scope.Scope>

const pre = [
  WellKnownPlugin.Plugin,
  AgentPlugin.Plugin,
  CommandPlugin.Plugin,
  SkillPlugin.Plugin,
  ...SystemPromptPlugin.Plugins,
  ModelsDevPlugin,
  ...ProviderPlugins,
  ...WebSearchPlugins,
  PatchTool.Plugin,
  EditTool.Plugin,
  GlobTool.Plugin,
  GrepTool.Plugin,
  QuestionTool.Plugin,
  ReadTool.Plugin,
  ShellTool.Plugin,
  SkillTool.Plugin,
  SubagentTool.Plugin,
  WebFetchTool.Plugin,
  WebSearchTool.Plugin,
  WriteTool.Plugin,
  WarmingPlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

const post = [
  ConfigReferencePlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  ConfigCommandPlugin.Plugin,
  ConfigSkillPlugin.Plugin,
  ConfigProviderPlugin.Plugin,
  ConfigWebSearchPlugin.Plugin,
  VariantPlugin.Plugin,
  ConfigPolicyPlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

export const list = Effect.fn("PluginInternal.list")(function* () {
  const context = yield* services()
  const resolve = (plugins: readonly InternalPlugin[]) =>
    plugins.map(
      (plugin): Plugin => ({
        id: plugin.id,
        effect: (host) => plugin.effect(host).pipe(Effect.provide(context)),
      }),
    )
  return {
    pre: resolve(pre),
    post: resolve(post),
  }
})
