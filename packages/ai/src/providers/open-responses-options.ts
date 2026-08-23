import type { Options } from "../protocols/utils/open-responses-options.js"

export type OpenResponsesOptionsInput = Options & { readonly [key: string]: unknown }
export type OpenResponsesProviderOptionsInput = OpenResponsesOptionsInput

export * as OpenResponsesProviderOptions from "./open-responses-options.js"
