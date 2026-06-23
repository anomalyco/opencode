import type {
  IntegrationCredential,
  IntegrationDraft,
  IntegrationMethod,
  IntegrationMethodRegistration,
} from "../effect/integration.js"
import type { Hooks } from "./registration.js"

export type { IntegrationCredential, IntegrationDraft, IntegrationMethod, IntegrationMethodRegistration }

export interface IntegrationHooks extends Hooks<{ transform: IntegrationDraft }> {
  readonly connection: {
    readonly active: (
      integrationID: string,
    ) => Promise<import("@opencode-ai/sdk/v2/types").ConnectionInfo | undefined>
    readonly resolve: (
      connection: import("@opencode-ai/sdk/v2/types").ConnectionInfo,
    ) => Promise<IntegrationCredential | undefined>
  }
}
