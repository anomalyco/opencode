import type { WebSearch } from "@opencode-ai/schema/websearch"
import type { WebSearchApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface WebSearchDefinition {
  readonly id: string
  readonly name: string
  readonly execute: (input: WebSearch.ProviderInput) => Effect.Effect<readonly WebSearch.Result[], unknown>
}

export interface WebSearchDomain extends WebSearchApi<unknown> {
  readonly transform: Transform<WebSearchDraft>
  readonly reload: () => Effect.Effect<void>
}

export interface WebSearchDraft {
  add(definition: WebSearchDefinition): void
  readonly default: {
    get(): string | false | undefined
    set(selection: string | false): void
  }
}
