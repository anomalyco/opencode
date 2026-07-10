import { Schema } from "effect"
import type { LLMRequest, ReasoningEffort, TextVerbosity as TextVerbosityValue } from "../../schema"
import { ReasoningEfforts, TextVerbosity } from "../../schema"

export const OpenAIReasoningEfforts = ReasoningEfforts.filter(
  (effort): effort is Exclude<ReasoningEffort, "max"> => effort !== "max",
)
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEfforts)[number]

// Mirrors OpenAI's `ResponseIncludable` union from the official SDK. Keep this
// in lockstep with `openai-node/src/resources/responses/responses.ts`.
export const OpenAIResponseIncludables = [
  "file_search_call.results",
  "web_search_call.results",
  "web_search_call.action.sources",
  "message.input_image.image_url",
  "computer_call_output.output.image_url",
  "code_interpreter_call.outputs",
  "reasoning.encrypted_content",
  "message.output_text.logprobs",
] as const
export type OpenAIResponseIncludable = (typeof OpenAIResponseIncludables)[number]
export const OpenAIServiceTiers = ["auto", "default", "flex", "priority"] as const
export type OpenAIServiceTier = (typeof OpenAIServiceTiers)[number]
export const OpenAIPromptCacheModes = ["implicit", "explicit"] as const
export type OpenAIPromptCacheMode = (typeof OpenAIPromptCacheModes)[number]
export const OpenAIPromptCacheTTLs = ["30m"] as const
export type OpenAIPromptCacheTTL = (typeof OpenAIPromptCacheTTLs)[number]

const REASONING_EFFORTS = new Set<string>(ReasoningEfforts)
const OPENAI_REASONING_EFFORTS = new Set<string>(OpenAIReasoningEfforts)
const TEXT_VERBOSITY = new Set<string>(["low", "medium", "high"])
const INCLUDABLES = new Set<string>(OpenAIResponseIncludables)
const SERVICE_TIERS = new Set<string>(OpenAIServiceTiers)
const PROMPT_CACHE_MODES = new Set<string>(OpenAIPromptCacheModes)
const PROMPT_CACHE_TTLS = new Set<string>(OpenAIPromptCacheTTLs)

export const OpenAIReasoningEffort = Schema.Literals(OpenAIReasoningEfforts)
export const OpenAITextVerbosity = TextVerbosity
export const OpenAIResponseIncludable = Schema.Literals(OpenAIResponseIncludables)
export const OpenAIServiceTier = Schema.Literals(OpenAIServiceTiers)
export const OpenAIPromptCacheOptions = Schema.Struct({
  mode: Schema.optional(Schema.Literals(OpenAIPromptCacheModes)),
  ttl: Schema.optional(Schema.Literals(OpenAIPromptCacheTTLs)),
})
export type OpenAIPromptCacheOptions = Schema.Schema.Type<typeof OpenAIPromptCacheOptions>

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

export const reasoningSummary = (request: LLMRequest): "auto" | undefined =>
  options(request)?.reasoningSummary === "auto" ? "auto" : undefined

// Resolve the OpenAI Responses `include` field. Filters out unknown
// includable values defensively so a typo in upstream config drops the
// invalid entry instead of poisoning the wire body. An empty array (either
// passed directly or produced by filtering) is treated as "no include" and
// returns undefined so the request body omits the field entirely.
export const include = (request: LLMRequest): ReadonlyArray<OpenAIResponseIncludable> | undefined => {
  const value = options(request)?.include
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((entry): entry is OpenAIResponseIncludable => INCLUDABLES.has(entry))
  return filtered.length > 0 ? filtered : undefined
}

export const promptCacheKey = (request: LLMRequest) => {
  const value = options(request)?.promptCacheKey
  return typeof value === "string" ? value : undefined
}

export const promptCacheOptions = (request: LLMRequest): OpenAIPromptCacheOptions | undefined => {
  const value = options(request)?.promptCacheOptions
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const mode =
    typeof input.mode === "string" && PROMPT_CACHE_MODES.has(input.mode)
      ? (input.mode as OpenAIPromptCacheMode)
      : undefined
  const ttl =
    typeof input.ttl === "string" && PROMPT_CACHE_TTLS.has(input.ttl)
      ? (input.ttl as OpenAIPromptCacheTTL)
      : undefined
  if (!mode && !ttl) return undefined
  return { mode, ttl }
}

export const textVerbosity = (request: LLMRequest) => {
  const value = options(request)?.textVerbosity
  return isTextVerbosity(value) ? value : undefined
}

export const serviceTier = (request: LLMRequest) => {
  const value = options(request)?.serviceTier
  return typeof value === "string" && SERVICE_TIERS.has(value) ? (value as OpenAIServiceTier) : undefined
}

export const instructions = (request: LLMRequest) => {
  const value = options(request)?.instructions
  return typeof value === "string" ? value : undefined
}

export * as OpenAIOptions from "./openai-options"
