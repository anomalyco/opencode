export * as PluginInternal from "./internal.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { AppProcess } from "@opencode-ai/util/process"
import { Context, Effect, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Agent } from "../agent.js"
import { Catalog } from "../catalog.js"
import { Command } from "../command.js"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { ConfigCommandPlugin } from "../config/plugin/command.js"
import { ConfigFormatterPlugin } from "../config/plugin/formatter.js"
import { ConfigImagePlugin } from "../config/plugin/image.js"
import { ConfigInstructionPlugin } from "../config/plugin/instruction.js"
import { ConfigMCPPlugin } from "../config/plugin/mcp.js"
import { ConfigProviderPlugin } from "../config/plugin/provider.js"
import { ConfigPolicyPlugin } from "../config/plugin/policy.js"
import { ConfigReferencePlugin } from "../config/plugin/reference.js"
import { ConfigSkillPlugin } from "../config/plugin/skill.js"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch.js"
import { Bus } from "../bus.js"
import { Environment } from "../environment/index.js"
import { FileMutation } from "../file-mutation.js"
import { Formatter } from "../formatter.js"
import { Form } from "../form.js"
import { FileSystem } from "../filesystem.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Image } from "../image.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Integration } from "../integration.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { LocationMutation } from "../location-mutation.js"
import { ModelsDev } from "../models-dev.js"
import { MCP } from "../mcp/index.js"
import { Npm } from "@opencode-ai/util/npm"
import { Permission } from "../permission.js"
import { Reference } from "../reference.js"
import { WebSearch } from "../websearch.js"
import { Ripgrep } from "../ripgrep.js"
import { SessionInstructions } from "../session/instructions.js"
import { Shell } from "../shell.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"
import { Watcher } from "../filesystem/watcher.js"
import { PatchTool } from "../tool/plugin/patch.js"
import { EditTool } from "../tool/plugin/edit.js"
import { GlobTool } from "../tool/plugin/glob.js"
import { GrepTool } from "../tool/plugin/grep.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { ReadToolFileSystem } from "../tool/read-filesystem.js"
import { ReadTool } from "../tool/plugin/read.js"
import { ShellTool } from "../tool/plugin/shell.js"
import { SkillTool } from "../tool/plugin/skill.js"
import { SubagentTool } from "../tool/plugin/subagent.js"
import { Tool } from "../tool.js"
import { WebFetchTool } from "../tool/plugin/webfetch.js"
import { WebSearchTool } from "../tool/plugin/websearch.js"
import { WellKnown } from "../wellknown.js"
import { WriteTool } from "../tool/plugin/write.js"
import { AgentPlugin } from "./agent.js"
import { CommandPlugin } from "./command.js"
import { PlanPlugin } from "./plan.js"
import { ModelsDevPlugin } from "./models-dev.js"
import { MCPCodeModeExclusionPlugin } from "./mcp-codemode-exclusion.js"
import { ProviderPlugins } from "./provider.js"
import { WebSearchPlugins } from "./websearch/index.js"
import { PluginRuntime } from "./runtime.js"
import { SkillPlugin } from "./skill.js"
import { SystemPromptPlugin } from "./system-prompt.js"
import { VariantPlugin } from "./variant.js"
import { WarmingPlugin } from "./warming.js"
import { WellKnownPlugin } from "../wellknown/plugin.js"

const services = Effect.fn("PluginInternal.services")(function* () {
  const agent = yield* Agent.Service
  const processes = yield* AppProcess.Service
  const catalog = yield* Catalog.Service
  const command = yield* Command.Service
  const config = yield* Config.Service
  const credential = yield* Credential.Service
  const pluginSources = yield* ConfigPluginSource.Service
  const bus = yield* Bus.Service
  const environment = yield* Environment.Service
  const mutation = yield* FileMutation.Service
  const formatter = yield* Formatter.Service
  const filesystem = yield* FileSystem.Service
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const http = yield* HttpClient.HttpClient
  const image = yield* Image.Service
  const instructionDiscovery = yield* InstructionDiscovery.Service
  const integration = yield* Integration.Service
  const kv = yield* KV.Service
  const location = yield* Location.Service
  const locationMutation = yield* LocationMutation.Service
  const models = yield* ModelsDev.Service
  const mcp = yield* MCP.Service
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
    Context.make(AppProcess.Service, processes),
    Context.make(Catalog.Service, catalog),
    Context.make(Command.Service, command),
    Context.make(Config.Service, config),
    Context.make(Credential.Service, credential),
    Context.make(ConfigPluginSource.Service, pluginSources),
    Context.make(Bus.Service, bus),
    Context.make(Environment.Service, environment),
    Context.make(FileMutation.Service, mutation),
    Context.make(Formatter.Service, formatter),
    Context.make(FileSystem.Service, filesystem),
    Context.make(FSUtil.Service, fs),
    Context.make(Global.Service, global),
    Context.make(HttpClient.HttpClient, http),
    Context.make(Image.Service, image),
    Context.make(InstructionDiscovery.Service, instructionDiscovery),
    Context.make(Integration.Service, integration),
    Context.make(KV.Service, kv),
    Context.make(Location.Service, location),
    Context.make(LocationMutation.Service, locationMutation),
    Context.make(ModelsDev.Service, models),
    Context.make(MCP.Service, mcp),
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
  AppProcess.node,
  Catalog.node,
  Command.node,
  Config.node,
  Credential.node,
  ConfigPluginSource.node,
  Bus.node,
  Environment.node,
  FileMutation.node,
  Formatter.node,
  FileSystem.node,
  FSUtil.node,
  Global.node,
  httpClient,
  Image.node,
  InstructionDiscovery.node,
  Integration.node,
  KV.node,
  Location.node,
  LocationMutation.node,
  ModelsDev.node,
  MCP.node,
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
  ConfigMCPPlugin.Plugin,
  MCPCodeModeExclusionPlugin.Plugin,
  WellKnownPlugin.Plugin,
  AgentPlugin.Plugin,
  PlanPlugin.Plugin,
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
  ConfigInstructionPlugin.Plugin,
  ConfigReferencePlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  ConfigCommandPlugin.Plugin,
  ConfigFormatterPlugin.Plugin,
  ConfigImagePlugin.Plugin,
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
