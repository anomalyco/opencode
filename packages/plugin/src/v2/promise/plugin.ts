import type { PluginApi } from "@opencode-ai/client/promise/api"
import type { PluginOptions } from "../options.js"
import type { AgentDomain } from "./agent.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CatalogDomain } from "./catalog.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { IntegrationDomain } from "./integration.js"
import type { ReferenceDomain } from "./reference.js"
import type { SessionDomain } from "./session.js"
import type { SkillDomain } from "./skill.js"
import type { ToolDomain } from "./tool.js"

export interface Context {
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly integration: IntegrationDomain
  readonly plugin: PluginApi
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly skill: SkillDomain
  readonly tool: ToolDomain
}

export interface Plugin {
  readonly id: string
  readonly setup: (context: Context) => Promise<void> | void
}

export function define(plugin: Plugin) {
  return plugin
}
