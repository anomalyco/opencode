import type { ExperimentalApi, GenerateApi, PluginApi } from "@opencode-ai/client/effect/api"
import type { Location } from "@opencode-ai/schema/location"
import type { Effect, Scope } from "effect"
import type { PluginOptions } from "../options.js"
import type { App } from "../app.js"
import type { AgentDomain } from "./agent.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CatalogDomain } from "./catalog.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { IntegrationDomain } from "./integration.js"
import type { MCPDomain } from "./mcp.js"
import type { PermissionDomain } from "./permission.js"
import type { ReferenceDomain } from "./reference.js"
import type { RpcDomain } from "./rpc.js"
import type { SessionDomain } from "./session.js"
import type { ShellDomain } from "./shell.js"
import type { SkillDomain } from "./skill.js"
import type { StorageDomain } from "./storage.js"
import type { ToolDomain } from "./tool.js"
import type { VcsDomain } from "./vcs.js"
import type { WebSearchDomain } from "./websearch.js"
import type { WorktreeDomain } from "./worktree.js"

export interface Context {
  readonly app: App
  readonly location: Location.Info
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly experimental: {
    readonly terminal: Pick<ExperimentalApi<unknown>["persistentPty"], "read">
  }
  readonly integration: IntegrationDomain
  readonly mcp: MCPDomain
  readonly generate: GenerateApi<unknown>
  readonly permission: PermissionDomain
  readonly plugin: Pick<PluginApi<unknown>, "list">
  readonly reference: ReferenceDomain
  readonly rpc: RpcDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  readonly tool: ToolDomain
  readonly vcs: VcsDomain
  readonly websearch: WebSearchDomain
  readonly worktree: WorktreeDomain
}

export interface Plugin<R = Scope.Scope> {
  readonly id: string
  readonly effect: (context: Context) => Effect.Effect<void, never, R>
}

export function define<R = Scope.Scope>(plugin: Plugin<R>) {
  return plugin
}
