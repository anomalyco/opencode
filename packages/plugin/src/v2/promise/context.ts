import type { PluginOptions } from "../options.js"
import type { AgentHooks } from "./agent.js"
import type { AISDKHooks } from "./aisdk.js"
import type { CatalogHooks } from "./catalog.js"
import type { CommandHooks } from "./command.js"
import type { IntegrationHooks } from "./integration.js"
import type { PluginHooks } from "./plugin.js"
import type { ReferenceHooks } from "./reference.js"
import type { SkillHooks } from "./skill.js"

export interface PluginContext {
  readonly options: PluginOptions
  readonly hook: {
    readonly agent: AgentHooks
    readonly aisdk: AISDKHooks
    readonly catalog: CatalogHooks
    readonly command: CommandHooks
    readonly integration: IntegrationHooks
    readonly plugin: PluginHooks
    readonly reference: ReferenceHooks
    readonly skill: SkillHooks
  }
  readonly reload: {
    readonly agent: () => Promise<void>
    readonly catalog: () => Promise<void>
    readonly command: () => Promise<void>
    readonly integration: () => Promise<void>
    readonly plugin: () => Promise<void>
    readonly reference: () => Promise<void>
    readonly skill: () => Promise<void>
  }
}
