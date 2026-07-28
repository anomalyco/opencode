import type {
  ConnectionInfo,
  IntegrationCommandMethod,
  IntegrationEnvMethod,
  IntegrationKeyMethod,
  IntegrationMethod,
  IntegrationOAuthMethod,
} from "@opencode-ai/client"
import type { IntegrationApi } from "@opencode-ai/client/promise/api"
import { Credential } from "@opencode-ai/schema/credential"
import type { Transform } from "./registration.js"

type IntegrationInputs = Record<string, string>
type IntegrationRef = { id: string; name: string }

export type IntegrationOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
  readonly expiresAt?: number
} & (
  | {
      readonly mode: "auto"
      readonly callback: Promise<Credential.OAuth>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Promise<Credential.OAuth>
    }
)

export type IntegrationOAuthMethodRegistration = {
  readonly integrationID: string
  readonly method: IntegrationOAuthMethod
  readonly authorize: (inputs: IntegrationInputs) => Promise<IntegrationOAuthAuthorization>
  readonly refresh?: (credential: Credential.OAuth) => Promise<Credential.OAuth>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}

export type IntegrationMethodRegistration =
  | IntegrationOAuthMethodRegistration
  | { readonly integrationID: string; readonly method: IntegrationCommandMethod }
  | { readonly integrationID: string; readonly method: IntegrationKeyMethod }
  | { readonly integrationID: string; readonly method: IntegrationEnvMethod }

export interface IntegrationDraft {
  list(): readonly IntegrationRef[]
  get(id: string): IntegrationRef | undefined
  update(id: string, update: (integration: IntegrationRef) => void): void
  remove(id: string): void
  readonly method: {
    list(integrationID: string): readonly IntegrationMethod[]
    update(input: IntegrationMethodRegistration): void
    remove(integrationID: string, method: IntegrationMethod): void
  }
}

export interface IntegrationDomain extends Omit<IntegrationApi, "wellknown"> {
  readonly transform: Transform<IntegrationDraft>
  readonly reload: () => Promise<void>
  readonly connection: {
    readonly active: (integrationID: string) => Promise<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Promise<Credential.Value | undefined>
  }
}
