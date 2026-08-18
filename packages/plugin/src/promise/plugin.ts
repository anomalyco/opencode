import type { PluginApi } from "@opencode-ai/client/promise/api"
import type { PluginOptions } from "../options.js"
import type { App } from "../app.js"
import type { AgentDomain } from "./agent.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CatalogDomain } from "./catalog.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { IntegrationDomain } from "./integration.js"
import type { MCPDomain } from "./mcp.js"
import type { ReferenceDomain } from "./reference.js"
import type { SessionDomain } from "./session.js"
import type { ShellDomain } from "./shell.js"
import type { SkillDomain } from "./skill.js"
import type { ToolDomain } from "./tool.js"
import type { WebSearchDomain } from "./websearch.js"

export interface Context {
  readonly app: App
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly integration: IntegrationDomain
  readonly mcp: MCPDomain
  readonly plugin: PluginApi
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly tool: ToolDomain
  readonly websearch: WebSearchDomain
}

export type Cleanup = () => Promise<void> | void

export interface Plugin {
  readonly id: string
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}

export function define(plugin: Plugin) {
  return plugin
}
