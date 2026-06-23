import type {
  ConnectionInfo,
  IntegrationEnvMethod,
  IntegrationInfo,
  IntegrationKeyMethod,
  IntegrationOAuthMethod,
} from "@opencode-ai/sdk/v2/types"
import type { Effect, Scope } from "effect"
import type { Hooks } from "./registration.js"

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod
export type IntegrationOAuthCredential = {
  readonly type: "oauth"
  readonly refresh: string
  readonly access: string
  readonly expires: number
  readonly metadata?: Record<string, any>
}
export type IntegrationKeyCredential = {
  readonly type: "key"
  readonly key: string
  readonly metadata?: Record<string, any>
}
export type IntegrationCredential = IntegrationOAuthCredential | IntegrationKeyCredential
export type IntegrationOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<IntegrationCredential, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<IntegrationCredential, unknown>
    }
)
export type IntegrationOAuthMethodRegistration = {
  readonly integrationID: string
  readonly method: IntegrationOAuthMethod
  readonly authorize: (
    inputs: Readonly<Record<string, string>>,
  ) => Effect.Effect<IntegrationOAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (
    credential: IntegrationOAuthCredential,
  ) => Effect.Effect<IntegrationOAuthCredential, unknown>
  readonly label?: (credential: IntegrationCredential) => string | undefined
}
export type IntegrationMethodRegistration =
  | IntegrationOAuthMethodRegistration
  | {
      readonly integrationID: string
      readonly method: IntegrationKeyMethod
    }
  | {
      readonly integrationID: string
      readonly method: IntegrationEnvMethod
    }

export interface IntegrationDraft {
  list(): readonly Pick<IntegrationInfo, "id" | "name">[]
  get(id: string): Pick<IntegrationInfo, "id" | "name"> | undefined
  update(id: string, update: (integration: Pick<IntegrationInfo, "id" | "name">) => void): void
  remove(id: string): void
  readonly method: {
    list(integrationID: string): readonly IntegrationMethod[]
    update(input: IntegrationMethodRegistration): void
    remove(integrationID: string, method: IntegrationMethod): void
  }
}

export interface IntegrationHooks extends Hooks<{ transform: IntegrationDraft }> {
  readonly connection: {
    readonly active: (integrationID: string) => Effect.Effect<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Effect.Effect<IntegrationCredential | undefined, unknown>
  }
}
