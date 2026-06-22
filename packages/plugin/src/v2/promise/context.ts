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
  readonly agent: AgentHooks & { readonly reload: () => Promise<void> }
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & { readonly reload: () => Promise<void> }
  readonly command: CommandHooks & { readonly reload: () => Promise<void> }
  readonly integration: IntegrationHooks & { readonly reload: () => Promise<void> }
  readonly plugin: PluginHooks & { readonly reload: () => Promise<void> }
  readonly reference: ReferenceHooks & { readonly reload: () => Promise<void> }
  readonly skill: SkillHooks & { readonly reload: () => Promise<void> }
}
