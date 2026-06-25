import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export type AISDKHooks = Hooks<{
  sdk: {
    readonly model: ModelV2Info
    readonly package: string
    readonly options: Record<string, any>
    sdk?: any
  }
  language: {
    readonly model: ModelV2Info
    readonly sdk: any
    readonly options: Record<string, any>
    language?: LanguageModelV3
  }
}>
