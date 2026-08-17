import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { Model } from "@opencode-ai/schema/model"
import type { Hooks } from "./registration.js"

export interface AISDKHooks {
  sdk: {
    readonly model: Model.Info
    readonly package: string
    readonly options: Record<string, any>
    sdk?: any
  }
  language: {
    readonly model: Model.Info
    readonly sdk: any
    readonly options: Record<string, any>
    language?: LanguageModelV3
  }
}

export interface AISDKDomain {
  readonly hook: Hooks<AISDKHooks>
}
