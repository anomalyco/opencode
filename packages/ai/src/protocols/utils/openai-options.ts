import { Option, Schema } from "effect"
import type { LLMRequest } from "../../schema/index.js"
import { OpenResponsesOptions } from "./open-responses-options.js"

export const OpenAIReasoningEfforts = OpenResponsesOptions.ReasoningEfforts
export type OpenAIReasoningEffort = OpenResponsesOptions.ReasoningEffort
export const OpenAITextVerbosities = OpenResponsesOptions.TextVerbosities
export type OpenAITextVerbosity = OpenResponsesOptions.TextVerbosity

// Mirrors OpenAI's `ResponseIncludable` union from the official SDK. Keep this
// in lockstep with `openai-node/src/resources/responses/responses.ts`.
export const OpenAIResponseIncludables = OpenResponsesOptions.ResponseIncludables
export type OpenAIResponseIncludable = OpenResponsesOptions.ResponseIncludable
export const OpenAIServiceTiers = OpenResponsesOptions.ServiceTiers
export type OpenAIServiceTier = OpenResponsesOptions.ServiceTier

export const OpenAIReasoningEffort = OpenResponsesOptions.ReasoningEffort
export const OpenAITextVerbosity = OpenResponsesOptions.TextVerbosity
export const OpenAIResponseIncludable = OpenResponsesOptions.ResponseIncludableSchema
export const OpenAIServiceTier = OpenResponsesOptions.ServiceTierSchema

export const isReasoningEffort = (effort: unknown): effort is OpenAIReasoningEffort => typeof effort === "string"

export const ContextManagement = Schema.Array(
  Schema.Struct({
    type: Schema.tag("compaction"),
    compactThreshold: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
)
export type ContextManagement = typeof ContextManagement.Type

const Options = Schema.Struct({
  contextManagement: Schema.optional(ContextManagement),
})
const decodeOptions = Schema.decodeUnknownOption(Options)

export const resolve = (request: LLMRequest) => ({
  ...OpenResponsesOptions.resolve(request),
  ...Option.getOrElse(decodeOptions(request.providerOptions), () => ({})),
})

export * as OpenAIOptions from "./openai-options.js"
