import type { PluginOptions } from "../options.js"
import type { AgentHooks } from "./agent.js"
import type { AISDKHooks } from "./aisdk.js"
import type { CatalogHooks } from "./catalog.js"
import type { CommandHooks } from "./command.js"
import type { IntegrationHooks } from "./integration.js"
import type { PluginHooks } from "./plugin.js"
import type { ReferenceHooks } from "./reference.js"
import type { SkillHooks } from "./skill.js"
import type { Reload } from "./registration.js"

export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks & Reload
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & Reload
  readonly command: CommandHooks & Reload
  readonly integration: IntegrationHooks & Reload
  readonly plugin: PluginHooks & Reload
  readonly reference: ReferenceHooks & Reload
  readonly skill: SkillHooks & Reload
}
