import { Schema } from "effect"
import { ReasoningEffort, ReasoningEfforts, type LLMRequest } from "../../schema/index.js"
import { lenient } from "../shared.js"

export { ReasoningEffort, ReasoningEfforts }

export const TextVerbosities = ["low", "medium", "high"] as const
export type TextVerbosity = (typeof TextVerbosities)[number] | (string & {})
export const TextVerbosity = Schema.declare<TextVerbosity>(
  (value): value is TextVerbosity => typeof value === "string",
  { title: "TextVerbosity" },
)

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
export type ResponseIncludable = (typeof ResponseIncludables)[number] | (string & {})

export const ServiceTiers = ["auto", "default", "flex", "priority"] as const
export type ServiceTier = (typeof ServiceTiers)[number] | (string & {})
export const ServiceTier = Schema.declare<ServiceTier>((value): value is ServiceTier => typeof value === "string", {
  title: "ServiceTier",
})

export const Truncations = ["auto", "disabled"] as const
export type Truncation = (typeof Truncations)[number]

export const TextVerbositySchema = TextVerbosity
export const ResponseIncludableSchema = Schema.declare<ResponseIncludable>(
  (value): value is ResponseIncludable => typeof value === "string",
  { title: "ResponseIncludable" },
)
export const ServiceTierSchema = ServiceTier
export const TruncationSchema = Schema.Literals(Truncations)

export const AllowedTools = Schema.Struct({
  toolNames: Schema.Array(Schema.String),
  mode: Schema.optional(Schema.Literals(["auto", "none", "required"])),
})
export type AllowedTools = typeof AllowedTools.Type

export const StreamOptions = Schema.Struct({
  includeObfuscation: Schema.optional(Schema.Boolean),
})

// Malformed options are dropped one at a time so a bad `topLogprobs` cannot discard `store` or `reasoningEffort`.
export const Options = Schema.Struct({
  store: lenient(Schema.Boolean),
  metadata: lenient(Schema.Record(Schema.String, Schema.String)),
  safetyIdentifier: lenient(Schema.String),
  streamOptions: lenient(StreamOptions),
  topLogprobs: lenient(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 }))),
  reasoningEffort: lenient(ReasoningEffort),
  reasoningSummary: lenient(Schema.Literals(["auto", "concise", "detailed"])),
  include: lenient(Schema.Array(ResponseIncludableSchema)),
  textVerbosity: lenient(TextVerbositySchema),
  serviceTier: lenient(ServiceTierSchema),
  truncation: lenient(TruncationSchema),
  allowedTools: lenient(AllowedTools),
  maxToolCalls: lenient(Schema.Int),
  parallelToolCalls: lenient(Schema.Boolean),
})
export type Options = typeof Options.Type

export type Resolved = Omit<Options, "allowedTools"> & {
  readonly allowedTools?: AllowedTools & { readonly mode: NonNullable<AllowedTools["mode"]> }
}

const decodeOptions = Schema.decodeUnknownSync(Options)

export const resolve = (request: LLMRequest): Resolved => {
  const input = decodeOptions(request.providerOptions ?? {})
  return {
    ...input,
    include: input.include?.length ? input.include : undefined,
    allowedTools:
      input.allowedTools && input.allowedTools.toolNames.length > 0
        ? { ...input.allowedTools, mode: input.allowedTools.mode ?? "auto" }
        : undefined,
  }
}

export * as OpenResponsesOptions from "./open-responses-options.js"
