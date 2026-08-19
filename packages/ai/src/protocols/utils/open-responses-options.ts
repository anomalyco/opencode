import { Option, Schema } from "effect"
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

const INCLUDABLES = new Set<string>(ResponseIncludables)

export const ReasoningEffort = Schema.String
export const TextVerbositySchema = TextVerbosity
export const ResponseIncludableSchema = Schema.Literals(ResponseIncludables)
export const ServiceTierSchema = Schema.Literals(ServiceTiers)

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
  include: Schema.optional(Schema.Array(Schema.String)),
  textVerbosity: Schema.optional(TextVerbositySchema),
  serviceTier: Schema.optional(ServiceTierSchema),
  allowedTools: Schema.optional(AllowedTools),
  maxToolCalls: Schema.optional(Schema.Int),
  parallelToolCalls: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export type OptionsInput = Omit<Options, "include"> & {
  readonly include?: ReadonlyArray<ResponseIncludable>
}

export type Resolved = Omit<Options, "allowedTools" | "include"> & {
  readonly allowedTools?: AllowedTools & { readonly mode: NonNullable<AllowedTools["mode"]> }
  readonly include?: ReadonlyArray<ResponseIncludable>
}

const decodeOptions = Schema.decodeUnknownOption(Options)

export const resolve = (request: LLMRequest): Resolved => {
  const input = Option.getOrUndefined(
    decodeOptions(request.providerOptions?.[request.model.route.providerMetadataKey ?? "openresponses"]),
  )
  if (!input) return {}
  const include = input.include?.filter((entry): entry is ResponseIncludable => INCLUDABLES.has(entry)) ?? []
  return {
    ...input,
    include: include.length > 0 ? include : undefined,
    allowedTools:
      input.allowedTools && input.allowedTools.toolNames.length > 0
        ? { ...input.allowedTools, mode: input.allowedTools.mode ?? "auto" }
        : undefined,
  }
}

export * as OpenResponsesOptions from "./open-responses-options.js"
