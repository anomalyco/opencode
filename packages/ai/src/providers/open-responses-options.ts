import type { ResponseIncludable, ServiceTier } from "../protocols/utils/open-responses-options"
import type { ProviderOptions, ReasoningEffort, TextVerbosity } from "../schema"

export interface OpenResponsesOptionsInput {
  readonly [key: string]: unknown
  readonly instructions?: string
  readonly store?: boolean
  readonly promptCacheKey?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningSummary?: "auto" | "concise" | "detailed"
  readonly include?: ReadonlyArray<ResponseIncludable>
  readonly textVerbosity?: TextVerbosity
  readonly serviceTier?: ServiceTier
}

export type OpenResponsesProviderOptionsInput = ProviderOptions & {
  readonly openresponses?: OpenResponsesOptionsInput
}

export * as OpenResponsesProviderOptions from "./open-responses-options"
