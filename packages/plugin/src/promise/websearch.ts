import type { WebSearch } from "@opencode-ai/schema/websearch"
import type { WebSearchApi } from "@opencode-ai/client/promise/api"
import type { Transform } from "./registration.js"

export interface WebSearchDefinition {
  readonly id: string
  readonly name: string
  readonly execute: (
    input: WebSearch.ProviderInput,
    context: { readonly signal: AbortSignal },
  ) => Promise<readonly WebSearch.Result[]>
}

export interface WebSearchDomain extends WebSearchApi {
  readonly transform: Transform<WebSearchDraft>
  readonly reload: () => Promise<void>
}

export interface WebSearchDraft {
  add(definition: WebSearchDefinition): void
  readonly default: {
    get(): string | undefined
    set(providerID: string): void
  }
}
