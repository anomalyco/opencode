import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Hookable } from "./registration.js"

export interface AISDKHooks {
  readonly sdk: (event: {
    readonly model: ModelV2Info
    readonly package: string
    readonly options: Record<string, any>
    sdk?: any
  }) => Effect.Effect<void> | void
  readonly language: (event: {
    readonly model: ModelV2Info
    readonly sdk: any
    readonly options: Record<string, any>
    language?: LanguageModelV3
  }) => Effect.Effect<void> | void
}

export interface AISDK extends Hookable<AISDKHooks> {}
