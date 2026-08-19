import { Option, Schema } from "effect"
import type { LLMRequest } from "../../schema/index.js"

export const ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ReasoningEffort = (typeof ReasoningEfforts)[number] | (string & {})
export const ReasoningEffort = Schema.declare<ReasoningEffort>(
  (value): value is ReasoningEffort => typeof value === "string",
  { title: "ReasoningEffort" },
)

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
export type ServiceTier = (typeof ServiceTiers)[number]

export const Truncations = ["auto", "disabled"] as const
export type Truncation = (typeof Truncations)[number]

export const TextVerbositySchema = TextVerbosity
export const ResponseIncludableSchema = Schema.declare<ResponseIncludable>(
  (value): value is ResponseIncludable => typeof value === "string",
  { title: "ResponseIncludable" },
)
export const ServiceTierSchema = Schema.Literals(ServiceTiers)
export const TruncationSchema = Schema.Literals(Truncations)

export const AllowedTools = Schema.Struct({
  toolNames: Schema.Array(Schema.String),
  mode: Schema.optional(Schema.Literals(["auto", "none", "required"])),
})
export type AllowedTools = typeof AllowedTools.Type

export const Options = Schema.Struct({
  instructions: Schema.optional(Schema.String),
  store: Schema.optional(Schema.Boolean),
  reasoningEffort: Schema.optional(ReasoningEffort),
  reasoningSummary: Schema.optional(Schema.Literals(["auto", "concise", "detailed"])),
  include: Schema.optional(Schema.Array(ResponseIncludableSchema)),
  textVerbosity: Schema.optional(TextVerbositySchema),
  serviceTier: Schema.optional(ServiceTierSchema),
  truncation: Schema.optional(TruncationSchema),
  allowedTools: Schema.optional(AllowedTools),
  maxToolCalls: Schema.optional(Schema.Int),
  parallelToolCalls: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export type Resolved = Omit<Options, "allowedTools"> & {
  readonly allowedTools?: AllowedTools & { readonly mode: NonNullable<AllowedTools["mode"]> }
}

const decodeOptions = Schema.decodeUnknownOption(Options)

export const resolve = (request: LLMRequest): Resolved => {
  const input = Option.getOrUndefined(decodeOptions(request.providerOptions))
  if (!input) return {}
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
