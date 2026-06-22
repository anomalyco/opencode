import type { Effect } from "effect"
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
  readonly agent: AgentHooks & { readonly reload: () => Effect.Effect<void> }
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & { readonly reload: () => Effect.Effect<void> }
  readonly command: CommandHooks & { readonly reload: () => Effect.Effect<void> }
  readonly integration: IntegrationHooks & { readonly reload: () => Effect.Effect<void> }
  readonly plugin: PluginHooks & { readonly reload: () => Effect.Effect<void> }
  readonly reference: ReferenceHooks & { readonly reload: () => Effect.Effect<void> }
  readonly skill: SkillHooks & { readonly reload: () => Effect.Effect<void> }
}
