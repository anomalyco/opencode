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
  readonly transform: Transform<WebSearchEditor>
  readonly reload: () => Promise<void>
}

export interface WebSearchEditor {
  add(definition: WebSearchDefinition): void
  readonly default: {
    get(): string | false | undefined
    set(selection: string | false): void
  }
}
