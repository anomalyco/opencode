export * as PluginInternal from "./internal"

import type { Plugin } from "@opencode-ai/plugin/v2/effect/plugin"
import { Context, Effect, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { EventV2 } from "../event"
import { FileMutation } from "../file-mutation"
import { Form } from "../form"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Image } from "../image"
import { Integration } from "../integration"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PermissionV2 } from "../permission"
import { Reference } from "../reference"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { Shell } from "../shell"
import { SkillV2 } from "../skill"
import { PatchTool } from "../tool/patch"
import { EditTool } from "../tool/edit"
import { GlobTool } from "../tool/glob"
import { GrepTool } from "../tool/grep"
import { QuestionTool } from "../tool/question"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { ReadTool } from "../tool/read"
import { ShellTool } from "../tool/shell"
import { SkillTool } from "../tool/skill"
import { SubagentTool } from "../tool/subagent"
import { Tools } from "../tool/tools"
import { WebFetchTool } from "../tool/webfetch"
import { WebSearchTool } from "../tool/websearch"
import { WriteTool } from "../tool/write"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { PluginRuntime } from "./runtime"
import { SkillPlugin } from "./skill"
import { SystemPromptPlugin } from "./system-prompt"
import { VariantPlugin } from "./variant"

const services = Effect.fn("PluginInternal.services")(function* () {
  const agent = yield* AgentV2.Service
  const catalog = yield* Catalog.Service
  const command = yield* CommandV2.Service
  const config = yield* Config.Service
  const events = yield* EventV2.Service
  const mutation = yield* FileMutation.Service
  const filesystem = yield* FileSystem.Service
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const http = yield* HttpClient.HttpClient
  const image = yield* Image.Service
  const integration = yield* Integration.Service
  const location = yield* Location.Service
  const locationMutation = yield* LocationMutation.Service
  const models = yield* ModelsDev.Service
  const npm = yield* Npm.Service
  const permission = yield* PermissionV2.Service
  const runtime = yield* PluginRuntime.Service
  const form = yield* Form.Service
  const read = yield* ReadToolFileSystem.Service
  const reference = yield* Reference.Service
  const ripgrep = yield* Ripgrep.Service
  const instructions = yield* SessionInstructions.Service
  const shell = yield* Shell.Service
  const skill = yield* SkillV2.Service
  const tools = yield* Tools.Service
  const websearch = yield* WebSearchTool.ConfigService
  return Context.mergeAll(
    Context.make(AgentV2.Service, agent),
    Context.make(Catalog.Service, catalog),
    Context.make(CommandV2.Service, command),
    Context.make(Config.Service, config),
    Context.make(EventV2.Service, events),
    Context.make(FileMutation.Service, mutation),
    Context.make(FileSystem.Service, filesystem),
    Context.make(FSUtil.Service, fs),
    Context.make(Global.Service, global),
    Context.make(HttpClient.HttpClient, http),
    Context.make(Image.Service, image),
    Context.make(Integration.Service, integration),
    Context.make(Location.Service, location),
    Context.make(LocationMutation.Service, locationMutation),
    Context.make(ModelsDev.Service, models),
    Context.make(Npm.Service, npm),
    Context.make(PermissionV2.Service, permission),
    Context.make(PluginRuntime.Service, runtime),
    Context.make(Form.Service, form),
    Context.make(ReadToolFileSystem.Service, read),
    Context.make(Reference.Service, reference),
    Context.make(Ripgrep.Service, ripgrep),
    Context.make(SessionInstructions.Service, instructions),
    Context.make(Shell.Service, shell),
    Context.make(SkillV2.Service, skill),
    Context.make(Tools.Service, tools),
    Context.make(WebSearchTool.ConfigService, websearch),
  )
})

type ContextServices<A> = A extends Context.Context<infer R> ? R : never

export type Requirements = ContextServices<Effect.Success<ReturnType<typeof services>>>

export type InternalPlugin = Plugin<Requirements | Scope.Scope>

const pre = [
  AgentPlugin.Plugin,
  CommandPlugin.Plugin,
  SkillPlugin.Plugin,
  ...SystemPromptPlugin.Plugins,
  ModelsDevPlugin,
  ...ProviderPlugins,
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
] as const satisfies readonly InternalPlugin[]

const post = [
  ConfigReferencePlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  ConfigCommandPlugin.Plugin,
  ConfigSkillPlugin.Plugin,
  ConfigProviderPlugin.Plugin,
  VariantPlugin.Plugin,
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
