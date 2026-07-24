import { Schema } from "effect"
import { TextVerbosity, type LLMRequest } from "../../schema"

export const ResponseIncludables = [
  "file_search_call.results",
  "web_search_call.results",
  "web_search_call.action.sources",
  "message.input_image.image_url",
  "computer_call_output.output.image_url",
  "code_interpreter_call.outputs",
  "reasoning.encrypted_content",
  "message.output_text.logprobs",
] as const
export type ResponseIncludable = (typeof ResponseIncludables)[number]

export const ServiceTiers = ["auto", "default", "flex", "priority"] as const
export type ServiceTier = (typeof ServiceTiers)[number]

const TEXT_VERBOSITY = new Set<string>(["low", "medium", "high"])
const INCLUDABLES = new Set<string>(ResponseIncludables)
const SERVICE_TIERS = new Set<string>(ServiceTiers)

const isTextVerbosity = (value: unknown): value is Schema.Schema.Type<typeof TextVerbosity> =>
  typeof value === "string" && TEXT_VERBOSITY.has(value)

const isServiceTier = (value: unknown): value is ServiceTier => typeof value === "string" && SERVICE_TIERS.has(value)

export const ReasoningEffort = Schema.String
export const TextVerbositySchema = TextVerbosity
export const ResponseIncludableSchema = Schema.Literals(ResponseIncludables)
export const ServiceTierSchema = Schema.Literals(ServiceTiers)

const options = (request: LLMRequest) =>
  request.providerOptions?.[request.model.route.providerMetadataKey ?? "openresponses"]

export const store = (request: LLMRequest): boolean | undefined => {
  const value = options(request)?.store
  return typeof value === "boolean" ? value : undefined
}

export const reasoningEffort = (request: LLMRequest): string | undefined => {
  const value = options(request)?.reasoningEffort
  return typeof value === "string" ? value : undefined
}

export const reasoningSummary = (request: LLMRequest): "auto" | "concise" | "detailed" | undefined => {
  const value = options(request)?.reasoningSummary
  return value === "auto" || value === "concise" || value === "detailed" ? value : undefined
}

export const include = (request: LLMRequest): ReadonlyArray<ResponseIncludable> | undefined => {
  const value = options(request)?.include
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((entry): entry is ResponseIncludable => INCLUDABLES.has(entry))
  return filtered.length > 0 ? filtered : undefined
}

export const promptCacheKey = (request: LLMRequest) => {
  const value = options(request)?.promptCacheKey
  return typeof value === "string" ? value : undefined
}

export const textVerbosity = (request: LLMRequest) => {
  const value = options(request)?.textVerbosity
  return isTextVerbosity(value) ? value : undefined
}

export const serviceTier = (request: LLMRequest) => {
  const value = options(request)?.serviceTier
  return isServiceTier(value) ? value : undefined
}

export const instructions = (request: LLMRequest) => {
  const value = options(request)?.instructions
  return typeof value === "string" ? value : undefined
}

export * as OpenResponsesOptions from "./open-responses-options"
