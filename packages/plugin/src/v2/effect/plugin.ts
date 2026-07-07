import type { PluginApi } from "@opencode-ai/client/effect/api"
import type { Effect, Scope } from "effect"
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
  readonly plugin: PluginApi<unknown>
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly skill: SkillDomain
  readonly tool: ToolDomain
}

export interface Plugin<R = Scope.Scope> {
  readonly id: string
  readonly effect: (context: Context) => Effect.Effect<void, never, R>
}

export function define<R = Scope.Scope>(plugin: Plugin<R>) {
  return plugin
}
