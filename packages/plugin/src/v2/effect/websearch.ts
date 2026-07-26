import type { WebSearch } from "@opencode-ai/schema/websearch"
import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

export interface WebSearchDefinition {
  readonly id: string
  readonly name: string
  readonly execute: (
    input: WebSearch.ProviderInput,
    context: { readonly sessionID?: string },
  ) => Effect.Effect<WebSearch.ProviderOutput, unknown>
}

export interface WebSearchDomain {
  readonly register: (definition: WebSearchDefinition) => Effect.Effect<Registration, never, Scope.Scope>
}
