import { Schema } from "effect"
import type { LLMRequest, ReasoningEffort, TextVerbosity as TextVerbosityValue } from "../../schema"
import { ReasoningEfforts, TextVerbosity } from "../../schema"

export const OpenAIReasoningEfforts = ReasoningEfforts.filter(
  (effort): effort is Exclude<ReasoningEffort, "max"> => effort !== "max",
)
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEfforts)[number]

const REASONING_EFFORTS = new Set<string>(ReasoningEfforts)
const OPENAI_REASONING_EFFORTS = new Set<string>(OpenAIReasoningEfforts)
const TEXT_VERBOSITY = new Set<string>(["low", "medium", "high"])

export const OpenAIReasoningEffort = Schema.Literals(OpenAIReasoningEfforts)
export const OpenAITextVerbosity = TextVerbosity

const isAnyReasoningEffort = (effort: unknown): effort is ReasoningEffort =>
  typeof effort === "string" && REASONING_EFFORTS.has(effort)

export const isReasoningEffort = (effort: unknown): effort is OpenAIReasoningEffort =>
  typeof effort === "string" && OPENAI_REASONING_EFFORTS.has(effort)

const isTextVerbosity = (value: unknown): value is TextVerbosityValue =>
  typeof value === "string" && TEXT_VERBOSITY.has(value)

const options = (request: LLMRequest) => request.providerOptions?.openai

export const store = (request: LLMRequest): boolean | undefined => {
  const value = options(request)?.store
  return typeof value === "boolean" ? value : undefined
}

export const reasoningEffort = (request: LLMRequest): ReasoningEffort | undefined => {
  const value = options(request)?.reasoningEffort
  return isAnyReasoningEffort(value) ? value : undefined
}

export const reasoningSummary = (request: LLMRequest): "auto" | undefined => {
  return options(request)?.reasoningSummary === "auto" ? "auto" : undefined
}

export const encryptedReasoning = (request: LLMRequest) =>
  options(request)?.includeEncryptedReasoning === true ? true : undefined

export const promptCacheKey = (request: LLMRequest) => {
  const value = options(request)?.promptCacheKey
  return typeof value === "string" ? value : undefined
}

export const textVerbosity = (request: LLMRequest) => {
  const value = options(request)?.textVerbosity
  return isTextVerbosity(value) ? value : undefined
}

export * as OpenAIOptions from "./openai-options"
