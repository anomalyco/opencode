import { ReasoningEfforts } from "../../schema"
import { OpenResponsesOptions } from "./open-responses-options"

export const OpenAIReasoningEfforts = ReasoningEfforts
export type OpenAIReasoningEffort = string

// Mirrors OpenAI's `ResponseIncludable` union from the official SDK. Keep this
// in lockstep with `openai-node/src/resources/responses/responses.ts`.
export const OpenAIResponseIncludables = OpenResponsesOptions.ResponseIncludables
export type OpenAIResponseIncludable = OpenResponsesOptions.ResponseIncludable
export const OpenAIServiceTiers = OpenResponsesOptions.ServiceTiers
export type OpenAIServiceTier = OpenResponsesOptions.ServiceTier

export const OpenAIReasoningEffort = OpenResponsesOptions.ReasoningEffort
export const OpenAITextVerbosity = OpenResponsesOptions.TextVerbositySchema
export const OpenAIResponseIncludable = OpenResponsesOptions.ResponseIncludableSchema
export const OpenAIServiceTier = OpenResponsesOptions.ServiceTierSchema

export const isReasoningEffort = (effort: unknown): effort is OpenAIReasoningEffort => typeof effort === "string"

export const resolve = OpenResponsesOptions.resolve

export * as OpenAIOptions from "./openai-options"
