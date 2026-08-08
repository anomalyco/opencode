import type { Credential } from "@opencode-ai/schema/credential"
import type { Model } from "@opencode-ai/schema/model"
import type { Hooks } from "./registration.js"

export interface ProviderHooks {
  resolve: {
    readonly model: Model.Info
    readonly credential?: Credential.Value
    readonly settings: Record<string, unknown>
  }
}

export interface ProviderDomain {
  readonly hook: Hooks<ProviderHooks>
}
