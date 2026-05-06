import { Schema } from "effect"
import type { LLMRequest, ReasoningEffort } from "../../schema"
import { ReasoningEfforts, TextVerbosity } from "../../schema"

export const OpenAIReasoningEfforts = ReasoningEfforts.filter(
  (effort): effort is Exclude<ReasoningEffort, "max"> => effort !== "max",
)
export type OpenAIReasoningEffort = typeof OpenAIReasoningEfforts[number]

const OPENAI_REASONING_EFFORTS = new Set<ReasoningEffort>(OpenAIReasoningEfforts)

export const OpenAIReasoningEffort = Schema.Literals(OpenAIReasoningEfforts)
export const OpenAITextVerbosity = TextVerbosity

export const isReasoningEffort = (effort: ReasoningEffort): effort is OpenAIReasoningEffort =>
  OPENAI_REASONING_EFFORTS.has(effort)

export const store = (request: LLMRequest) =>
  typeof request.model.policy?.retention?.store === "boolean" ? request.model.policy.retention.store : undefined

export const reasoningEffort = (request: LLMRequest): ReasoningEffort | undefined => {
  if (request.reasoning?.enabled === false) return undefined
  return request.reasoning?.effort ?? request.model.policy?.reasoning?.effort
}

export const reasoningSummary = (request: LLMRequest): "auto" | undefined => {
  if (request.reasoning?.enabled === false) return undefined
  if (request.reasoning?.summary !== undefined) return request.reasoning.summary ? "auto" : undefined
  const summary = request.model.policy?.reasoning?.summary
  return summary === true || summary === "auto" ? "auto" : undefined
}

export const encryptedReasoning = (request: LLMRequest) => {
  if (request.reasoning?.enabled === false) return undefined
  if (request.reasoning?.encryptedContent !== undefined) return request.reasoning.encryptedContent
  return request.model.policy?.reasoning?.encryptedState
}

export const promptCacheKey = (request: LLMRequest) => {
  if (request.cache?.enabled === false) return undefined
  return request.cache?.key ?? request.model.policy?.cache?.promptKey
}

export const textVerbosity = (request: LLMRequest) => request.model.policy?.text?.verbosity

export * as OpenAIOptions from "./openai-options"
