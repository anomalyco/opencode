import { Schema } from "effect"
import type { LLMRequest } from "../../schema"
import { ProviderShared } from "../shared"

export const ThinkingConfigSchema = Schema.Struct({
  thinkingBudget: Schema.optional(Schema.Number),
  includeThoughts: Schema.optional(Schema.Boolean),
})
export type ThinkingConfig = Schema.Schema.Type<typeof ThinkingConfigSchema>

export interface Resolved {
  readonly thinkingConfig?: ThinkingConfig
}

export const resolve = (request: LLMRequest): Resolved => {
  const value = request.providerOptions?.gemini?.thinkingConfig
  if (!ProviderShared.isRecord(value)) return {}
  const thinkingConfig = {
    thinkingBudget: typeof value.thinkingBudget === "number" ? value.thinkingBudget : undefined,
    includeThoughts: typeof value.includeThoughts === "boolean" ? value.includeThoughts : undefined,
  }
  return {
    thinkingConfig: Object.values(thinkingConfig).some((item) => item !== undefined) ? thinkingConfig : undefined,
  }
}

export * as GeminiOptions from "./gemini-options"
