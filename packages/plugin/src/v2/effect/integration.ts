import type {
  IntegrationEnvMethod,
  IntegrationInfo,
  IntegrationKeyMethod,
  IntegrationOAuthMethod,
} from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transformable } from "./registration.js"

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod
export type IntegrationMethodRegistration =
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

export interface Integration extends Transformable<IntegrationDraft> {
  get(id: string): Effect.Effect<IntegrationInfo | undefined>
  list(): Effect.Effect<IntegrationInfo[]>
}
