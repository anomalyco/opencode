import type { IntegrationApi } from "@opencode-ai/client/promise/api"
import type { IntegrationDraft, IntegrationMethodRegistration } from "../effect/integration.js"
import type {
  CredentialOAuth,
  CredentialValue,
  IntegrationEnvMethod,
  IntegrationInputs,
  IntegrationKeyMethod,
  IntegrationOAuthMethod,
} from "@opencode-ai/sdk/v2/types"
import type { Registration, Transform } from "./registration.js"

export type { IntegrationDraft, IntegrationMethodRegistration }

export type IntegrationOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
  readonly expiresAt?: number
} & (
  | {
      readonly mode: "auto"
      readonly callback: Promise<CredentialOAuth>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Promise<CredentialOAuth>
    }
)

export type IntegrationOAuthMethodDefinition = IntegrationOAuthMethod & {
  readonly authorize: (inputs: IntegrationInputs) => Promise<IntegrationOAuthAuthorization>
  readonly refresh?: (credential: CredentialOAuth) => Promise<CredentialOAuth>
  readonly credentialLabel?: (credential: CredentialOAuth) => string | undefined
}

export type IntegrationMethodDefinition = IntegrationOAuthMethodDefinition | IntegrationKeyMethod | IntegrationEnvMethod

export interface IntegrationDefinition {
  readonly id: string
  readonly name: string
  readonly methods?: readonly IntegrationMethodDefinition[]
}

export interface IntegrationDomain extends Omit<IntegrationApi, "wellknown"> {
  readonly register: (definition: IntegrationDefinition) => Promise<Registration>
  readonly transform: Transform<IntegrationDraft>
  readonly reload: () => Promise<void>
  readonly connection: {
    readonly active: (integrationID: string) => Promise<import("@opencode-ai/sdk/v2/types").ConnectionInfo | undefined>
    readonly resolve: (
      connection: import("@opencode-ai/sdk/v2/types").ConnectionInfo,
    ) => Promise<CredentialValue | undefined>
  }
}
