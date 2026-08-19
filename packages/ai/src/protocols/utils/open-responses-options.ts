import { Schema } from "effect"
import { TextVerbosity, type LLMRequest } from "../../schema/index.js"

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

export const Truncations = ["auto", "disabled"] as const
export type Truncation = (typeof Truncations)[number]

const TEXT_VERBOSITY = new Set<string>(["low", "medium", "high"])
const INCLUDABLES = new Set<string>(ResponseIncludables)
const SERVICE_TIERS = new Set<string>(ServiceTiers)
const TRUNCATIONS = new Set<string>(Truncations)

const isTextVerbosity = (value: unknown): value is Schema.Schema.Type<typeof TextVerbosity> =>
  typeof value === "string" && TEXT_VERBOSITY.has(value)

const isServiceTier = (value: unknown): value is ServiceTier => typeof value === "string" && SERVICE_TIERS.has(value)
const isTruncation = (value: unknown): value is Truncation => typeof value === "string" && TRUNCATIONS.has(value)

export const ReasoningEffort = Schema.String
export const TextVerbositySchema = TextVerbosity
export const ResponseIncludableSchema = Schema.Literals(ResponseIncludables)
export const ServiceTierSchema = Schema.Literals(ServiceTiers)
export const TruncationSchema = Schema.Literals(Truncations)

export interface Resolved {
  readonly instructions?: string
  readonly store?: boolean
  readonly reasoningEffort?: string
  readonly reasoningSummary?: "auto" | "concise" | "detailed"
  readonly include?: ReadonlyArray<ResponseIncludable>
  readonly textVerbosity?: Schema.Schema.Type<typeof TextVerbosity>
  readonly serviceTier?: ServiceTier
  readonly truncation?: Truncation
}

export const resolve = (request: LLMRequest): Resolved => {
  const input = request.providerOptions?.[request.model.route.providerMetadataKey ?? "openresponses"]
  const include = Array.isArray(input?.include)
    ? input.include.filter((entry): entry is ResponseIncludable => INCLUDABLES.has(entry))
    : []
  const reasoningSummary = input?.reasoningSummary
  return {
    instructions: typeof input?.instructions === "string" ? input.instructions : undefined,
    store: typeof input?.store === "boolean" ? input.store : undefined,
    reasoningEffort: typeof input?.reasoningEffort === "string" ? input.reasoningEffort : undefined,
    reasoningSummary:
      reasoningSummary === "auto" || reasoningSummary === "concise" || reasoningSummary === "detailed"
        ? reasoningSummary
        : undefined,
    include: include.length > 0 ? include : undefined,
    textVerbosity: isTextVerbosity(input?.textVerbosity) ? input.textVerbosity : undefined,
    serviceTier: isServiceTier(input?.serviceTier) ? input.serviceTier : undefined,
    truncation: isTruncation(input?.truncation) ? input.truncation : undefined,
  }
}

export * as OpenResponsesOptions from "./open-responses-options.js"
