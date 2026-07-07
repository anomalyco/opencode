import type { PluginOptions } from "../options.js"
import type { AgentHooks } from "./agent.js"
import type { AISDKHooks } from "./aisdk.js"
import type { CatalogHooks } from "./catalog.js"
import type { CommandHooks } from "./command.js"
import type { EventHooks } from "./event.js"
import type { IntegrationHooks } from "./integration.js"
import type { PluginDomain } from "./plugin.js"
import type { ReferenceHooks } from "./reference.js"
import type { SessionHooks } from "./session.js"
import type { SkillHooks } from "./skill.js"

export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks
  readonly command: CommandHooks
  readonly event: EventHooks
  readonly integration: IntegrationHooks
  readonly plugin: PluginDomain
  readonly reference: ReferenceHooks
  readonly session: SessionHooks
  readonly skill: SkillHooks
}
