import type { Integration } from "@opencode-ai/schema/integration"
import type { Model } from "@opencode-ai/schema/model"
import type { Provider } from "@opencode-ai/schema/provider"
import type { ModelHooks } from "./registration.js"

export interface ProviderHooks {
  readonly available: {
    readonly provider: Provider.Info
    readonly integration?: Integration.Info
    available: boolean
  }
  readonly "model.prepare": {
    /** Effective catalog model before provider package construction. */
    readonly model: Model.Info
    /** Final runtime package after native provider mapping. */
    readonly package: string
    modelID: string
    settings: Record<string, unknown>
  }
}

export interface ProviderDomain {
  readonly hook: ModelHooks<ProviderHooks>
}
