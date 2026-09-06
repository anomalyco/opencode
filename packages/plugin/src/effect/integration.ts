import type { ConnectionInfo } from "@opencode-ai/client"
import type { IntegrationApi } from "@opencode-ai/client/effect/api"
import { Credential } from "@opencode-ai/schema/credential"
import { Form } from "@opencode-ai/schema/form"
import type { Effect, Scope } from "effect"
import type { Transform } from "./registration.js"

type IntegrationRef = { id: string; name: string }

export interface IntegrationOAuthMethod {
  readonly id: string
  readonly type: "oauth"
  readonly label: string
  readonly form?: Form.Fields
}

export interface IntegrationCommandMethod {
  readonly id: string
  readonly type: "command"
  readonly label: string
  readonly command: ReadonlyArray<string>
}

export interface IntegrationKeyMethod {
  readonly type: "key"
  readonly label?: string
  readonly form?: Form.Fields
}

export interface IntegrationEnvMethod {
  readonly type: "env"
  readonly names: ReadonlyArray<string>
}

export type IntegrationMethod =
  | IntegrationOAuthMethod
  | IntegrationCommandMethod
  | IntegrationKeyMethod
  | IntegrationEnvMethod

export type IntegrationOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
  readonly expiresAt?: number
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<Credential.OAuth, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<Credential.OAuth, unknown>
    }
)
export type IntegrationOAuthMethodRegistration = {
  readonly integrationID: string
  readonly method: IntegrationOAuthMethod
  readonly authorize: (answer: Form.Answer) => Effect.Effect<IntegrationOAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (credential: Credential.OAuth) => Effect.Effect<Credential.OAuth, unknown>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}
export type IntegrationMethodRegistration =
  | IntegrationOAuthMethodRegistration
  | {
      readonly integrationID: string
      readonly method: IntegrationCommandMethod
    }
  | {
      readonly integrationID: string
      readonly method: IntegrationKeyMethod
    }
  | {
      readonly integrationID: string
      readonly method: IntegrationEnvMethod
    }

export interface IntegrationEditor {
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

export interface IntegrationDomain extends Omit<IntegrationApi<unknown>, "wellknown"> {
  readonly transform: Transform<IntegrationEditor>
  readonly reload: () => Effect.Effect<void>
  readonly connection: {
    readonly active: (integrationID: string) => Effect.Effect<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Effect.Effect<Credential.Value | undefined, unknown>
  }
}
