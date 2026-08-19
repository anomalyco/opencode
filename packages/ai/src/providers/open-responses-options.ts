import type { Options } from "../protocols/utils/open-responses-options.js"
import type { ProviderOptions } from "../schema/index.js"

export type OpenResponsesOptionsInput = Options & { readonly [key: string]: unknown }

export type OpenResponsesProviderOptionsInput = ProviderOptions & {
  readonly openresponses?: OpenResponsesOptionsInput
}

export * as OpenResponsesProviderOptions from "./open-responses-options.js"
