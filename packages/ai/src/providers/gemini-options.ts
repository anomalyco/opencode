import type { ThinkingConfig } from "../protocols/utils/gemini-options"
import type { ProviderOptions } from "../schema"

export interface GeminiOptionsInput {
  readonly [key: string]: unknown
  readonly thinkingConfig?: ThinkingConfig
}

export type GeminiProviderOptionsInput = ProviderOptions & {
  readonly gemini?: GeminiOptionsInput
}

export * as GeminiProviderOptions from "./gemini-options"
