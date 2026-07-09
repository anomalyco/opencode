import type { IntegrationApi } from "@opencode-ai/client/promise/api"
import type { IntegrationDraft, IntegrationMethodRegistration } from "../effect/integration.js"
import type { CredentialValue } from "@opencode-ai/sdk/v2/types"
import type { Transform } from "./registration.js"

export type { IntegrationDraft, IntegrationMethodRegistration }

export interface IntegrationDomain extends IntegrationApi {
  readonly transform: Transform<IntegrationDraft>
  readonly reload: () => Promise<void>
  readonly connection: {
    readonly active: (integrationID: string) => Promise<import("@opencode-ai/sdk/v2/types").ConnectionInfo | undefined>
    readonly resolve: (
      connection: import("@opencode-ai/sdk/v2/types").ConnectionInfo,
    ) => Promise<CredentialValue | undefined>
  }
}
