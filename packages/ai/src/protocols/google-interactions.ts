import { Effect, Option, Schema, SchemaGetter, Stream } from "effect"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import {
  HttpTransport,
  type Transport,
  type TransportExecution,
  type TransportPrepareInput,
} from "../route/transport/index.js"
import {
  AIError,
  ContentPolicyError,
  InvalidProviderOutputError,
  LLMEvent,
  ProviderID,
  Usage,
  type LLMRequest,
  type ProviderMetadata,
  type ToolResultPart,
} from "../schema/index.js"
import { Media } from "../media.js"
import { classifyProviderFailure, providerErrorMessage } from "../provider-error.js"
import { encodeJson } from "../utils/json.js"
import { JsonObject, knownString, lenient, optionalNull, ProviderShared } from "./shared.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { MediaInput } from "./utils/media-input.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { ToolStream } from "./utils/tool-stream.js"

const ADAPTER = "google-interactions"
const CONTINUATION = "requires_continuation"
// Matches Google's GenAI SDKs (Python, JS, and Go).
const MAX_STREAM_RECONNECTS_WITHOUT_PROGRESS = 3
const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

// =============================================================================
// Public Model Input
// =============================================================================
const ThinkingLevel = knownString<"minimal" | "low" | "medium" | "high">()
const Options = Schema.Struct({
  previousInteractionId: lenient(Schema.String),
  store: lenient(Schema.Boolean),
  thinkingLevel: lenient(ThinkingLevel),
  thinkingSummaries: lenient(knownString<"auto" | "none">()),
  serviceTier: lenient(knownString<"standard" | "flex" | "priority" | "deferred">()),
  safetySettings: lenient(Schema.Array(GeminiGenerateContent.SafetySetting)),
})
export type OptionsInput = typeof Options.Encoded
export type ProviderOptionsInput = OptionsInput
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))

// =============================================================================
// Request Body Schema
// =============================================================================
const Text = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
const MediaContent = Schema.Struct({
  type: Schema.Literals(["image", "audio", "video", "document"]),
  data: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
  mime_type: Schema.String,
})
const Content = Schema.Union([Text, MediaContent])
const InputStep = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["user_input", "model_output"]), content: Schema.Array(Content) }),
  Schema.Struct({
    type: Schema.Literal("thought"),
    signature: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.Array(Text)),
  }),
  Schema.Struct({
    type: Schema.Literal("function_call"),
    id: Schema.String,
    name: Schema.String,
    arguments: Schema.Unknown,
    signature: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("function_result"),
    call_id: Schema.String,
    name: Schema.String,
    result: Schema.Unknown,
    is_error: Schema.optional(Schema.Boolean),
  }),
])
type InputStep = typeof InputStep.Type
const ToolChoice = Schema.Union([
  Schema.Literals(["auto", "any", "none"]),
  Schema.Struct({ allowed_tools: Schema.Struct({ mode: Schema.Literal("any"), tools: Schema.Array(Schema.String) }) }),
])
const Body = Schema.Struct({
  model: Schema.String,
  input: Schema.optional(Schema.Array(InputStep)),
  stream: Schema.Literal(true),
  store: Schema.Boolean,
  previous_interaction_id: Schema.optional(Schema.String),
  continuation_token: Schema.optional(Schema.String),
  system_instruction: Schema.optional(Schema.String),
  service_tier: Schema.optional(Schema.String),
  safety_settings: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, threshold: Schema.String }))),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literal("function"),
        name: Schema.String,
        description: Schema.String,
        parameters: JsonObject,
      }),
    ),
  ),
  generation_config: Schema.Struct({
    max_output_tokens: Schema.optional(Schema.Number),
    temperature: Schema.optional(Schema.Number),
    top_p: Schema.optional(Schema.Number),
    seed: Schema.optional(Schema.Number),
    stop_sequences: Schema.optional(Schema.Array(Schema.String)),
    thinking_level: Schema.optional(ThinkingLevel),
    thinking_summaries: Schema.optional(Schema.String),
    tool_choice: Schema.optional(ToolChoice),
  }),
})

// =============================================================================
// Streaming Event Schema
// =============================================================================
const RawUsage = Schema.StructWithRest(
  Schema.Struct({
    total_input_tokens: optionalNull(Schema.Number),
    total_cached_tokens: optionalNull(Schema.Number),
    total_output_tokens: optionalNull(Schema.Number),
    total_thought_tokens: optionalNull(Schema.Number),
    total_tokens: optionalNull(Schema.Number),
    raw_prompt_token: optionalNull(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type RawUsage = typeof RawUsage.Type
const OutputStep = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(JsonObject),
  signature: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.Array(Text)),
  content: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }))),
})
type OutputStep = typeof OutputStep.Type
const KNOWN_DELTA_TYPES = new Set(["text", "arguments_delta", "thought_signature", "thought_summary"])
const UnknownDelta = Schema.Struct({
  type: Schema.String.check(Schema.makeFilter((type) => !KNOWN_DELTA_TYPES.has(type))),
}).pipe(
  Schema.decodeTo(Schema.Struct({ type: Schema.Literal("unknown"), rawType: Schema.String }), {
    decode: SchemaGetter.transform((delta) => ({ type: "unknown" as const, rawType: delta.type })),
    encode: SchemaGetter.forbidden(() => "Unknown Google Interactions deltas are decode-only"),
  }),
)
const Delta = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("arguments_delta"), arguments: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thought_signature"), signature: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thought_summary"), content: Text }),
  // Unknown output modalities must fail explicitly rather than disappearing from a successful response.
  UnknownDelta,
])
const Interaction = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.optional(Schema.String),
    status: Schema.String,
    continuation_token: optionalNull(Schema.String),
    usage: Schema.optional(RawUsage),
    errors: Schema.optional(
      Schema.Array(Schema.Struct({ code: Schema.optional(Schema.String), message: Schema.optional(Schema.String) })),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const KNOWN_EVENT_TYPES = new Set([
  "step.start",
  "step.delta",
  "step.stop",
  "interaction.created",
  "interaction.status_update",
  "interaction.completed",
  "error",
])
// Google may add stream event types. Unknown types are ignored, while a malformed known type still fails decoding.
const UnknownEvent = Schema.Struct({
  event_type: Schema.String.check(Schema.makeFilter((type) => !KNOWN_EVENT_TYPES.has(type))),
}).pipe(
  Schema.decodeTo(Schema.Struct({ event_type: Schema.Literal("unknown") }), {
    decode: SchemaGetter.transform(() => ({ event_type: "unknown" as const })),
    encode: SchemaGetter.forbidden(() => "Unknown Google Interactions stream events are decode-only"),
  }),
)
const ErrorDetail = Schema.StructWithRest(
  Schema.Struct({
    code: lenient(Schema.String),
    error_type: lenient(Schema.String),
    message: lenient(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Event = Schema.Union([
  Schema.Struct({ event_type: Schema.Literal("step.start"), index: Schema.Number, step: OutputStep }),
  Schema.Struct({ event_type: Schema.Literal("step.delta"), index: Schema.Number, delta: Delta }),
  Schema.Struct({ event_type: Schema.Literal("step.stop"), index: Schema.Number }),
  Schema.Struct({
    event_type: Schema.Literal("interaction.created"),
    interaction: Schema.Struct({ id: Schema.optional(Schema.String) }),
  }),
  Schema.Struct({
    event_type: Schema.Literal("interaction.status_update"),
    interaction_id: Schema.optional(Schema.String),
    status: Schema.String,
    continuation_token: optionalNull(Schema.String),
    usage: Schema.optional(RawUsage),
  }),
  Schema.Struct({ event_type: Schema.Literal("interaction.completed"), interaction: Interaction }),
  Schema.Struct({ event_type: Schema.Literal("error"), error: Schema.optionalKey(Schema.Unknown) }),
  UnknownEvent,
])
type Event = typeof Event.Type

// =============================================================================
// Parser State
// =============================================================================
interface ParserState {
  readonly route: string
  readonly metadataKey: string
  readonly lifecycle: Lifecycle.State
  readonly hop: number
  readonly hasToolCalls: boolean
  readonly usage?: RawUsage
  readonly continuedUsage: ReadonlyArray<RawUsage | undefined>
  readonly steps: Partial<Record<number, OutputStep>>
  readonly tools: ToolStream.State<number>
}
type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>]

// =============================================================================
// Request Body Construction
// =============================================================================
// https://aistudio.google.com/docs/document-processing#office-documents
const OFFICE_DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
])

export const mediaContent = Effect.fnUntraced(function* (asset: Media.Asset) {
  if (
    asset.kind !== "image" &&
    asset.kind !== "audio" &&
    asset.kind !== "video" &&
    asset.mediaType !== "application/pdf" &&
    asset.mediaType !== "text/csv" &&
    !OFFICE_DOCUMENT_MIME_TYPES.has(asset.mediaType)
  )
    return yield* ProviderShared.invalidRequest(
      `Google Interactions does not support ${asset.mediaType} document input`,
    )
  const type: (typeof MediaContent.Type)["type"] =
    asset.kind === "image" || asset.kind === "audio" || asset.kind === "video" ? asset.kind : "document"
  const uri =
    asset.kind === "video" && asset.source.type === "url" && /^https?:\/\//i.test(asset.source.url)
      ? asset.source.url
      : MediaInput.refID(asset, ProviderID.make("google"))
  if (uri !== undefined) return { type, uri, mime_type: asset.mediaType }
  const inline = yield* ProviderShared.requireInlineMedia("Google Interactions", asset)
  return { type, data: inline.base64, mime_type: inline.mime }
})

const signature = (metadata: ProviderMetadata | undefined, key: string) => {
  const value = metadata?.[key]
  return typeof value?.interactionSignature === "string" ? value.interactionSignature : undefined
}

const lowerMessages = Effect.fnUntraced(function* (request: LLMRequest) {
  const steps: InputStep[] = []
  const key = request.model.route.providerMetadataKey ?? request.model.provider
  for (const message of request.messages) {
    if (message.role === "system") {
      const part = yield* ProviderShared.wrappedSystemUpdate("Google Interactions", message)
      steps.push({ type: "user_input", content: [{ type: "text", text: part.text }] })
      continue
    }
    const start = steps.length
    // Consecutive ordinary content remains one native message; tools and thoughts retain their chronology.
    const append = (content: typeof Content.Type) => {
      const type = message.role === "assistant" ? "model_output" : "user_input"
      const last = steps.at(-1)
      if (steps.length > start && last?.type === type)
        steps[steps.length - 1] = { type, content: [...last.content, content] }
      else steps.push({ type, content: [content] })
    }
    let hasSignedStep = false
    for (const part of message.content) {
      if (message.role === "tool") {
        if (part.type !== "tool-result")
          return yield* ProviderShared.unsupportedContent(ADAPTER, "tool", ["tool-result"])
        steps.push({
          type: "function_result",
          call_id: part.id,
          name: part.name,
          result: yield* lowerToolResult(part),
          is_error: part.result.type === "error" || undefined,
        })
        continue
      }
      if (part.type === "text") {
        append({ type: "text", text: part.text })
        continue
      }
      if (part.type === "media") {
        append(yield* mediaContent(part.media))
        continue
      }
      if (message.role === "assistant" && part.type === "reasoning") {
        const thoughtSignature = signature(part.providerMetadata, key)
        steps.push({
          type: "thought",
          signature: thoughtSignature,
          summary: part.text ? [{ type: "text", text: part.text }] : undefined,
        })
        if (thoughtSignature !== undefined) hasSignedStep = true
        continue
      }
      if (message.role === "assistant" && part.type === "tool-call") {
        const toolSignature = signature(part.providerMetadata, key)
        steps.push({
          type: "function_call",
          id: part.id,
          name: part.name,
          arguments: part.input,
          signature: toolSignature ?? (!hasSignedStep ? SKIP_THOUGHT_SIGNATURE_VALIDATOR : undefined),
        })
        if (toolSignature !== undefined) hasSignedStep = true
        continue
      }
      return yield* ProviderShared.unsupportedContent(
        ADAPTER,
        message.role,
        message.role === "user" ? ["text", "media"] : ["text", "media", "reasoning", "tool-call"],
      )
    }
  }
  return steps
})

const lowerToolResult = Effect.fnUntraced(function* (part: ToolResultPart) {
  if (part.result.type === "json" && ProviderShared.isRecord(part.result.value)) return part.result.value
  if (part.result.type !== "content") return ProviderShared.toolResultText(part)

  return yield* Effect.forEach(part.result.value, (item): Effect.Effect<typeof Content.Type, AIError> => {
    if (item.type === "text") return Effect.succeed({ type: "text", text: item.text })
    return mediaContent(GeminiGenerateContent.toolMedia(item))
  })
})

const fromRequest = Effect.fn("GoogleInteractions.fromRequest")(function* (request: LLMRequest) {
  const options = yield* decodeOptions(request.providerOptions ?? {})
  const definitions = ProviderShared.flattenTools(request.tools)
  if (definitions.some((tool) => tool.native !== undefined))
    return yield* ProviderShared.invalidRequest("Google Interactions hosted tools are not supported")
  if (request.topK !== undefined || request.frequencyPenalty !== undefined || request.presencePenalty !== undefined)
    return yield* ProviderShared.invalidRequest(
      "Google Interactions does not support topK, frequencyPenalty, or presencePenalty",
    )
  const choice =
    request.toolChoice === undefined
      ? undefined
      : yield* ProviderShared.matchToolChoice(ADAPTER, request.toolChoice, {
          auto: () => "auto" as const,
          none: () => "none" as const,
          required: () => "any" as const,
          tool: (name) => ({ allowed_tools: { mode: "any" as const, tools: [name] } }),
        })
  return {
    model: request.model.id,
    input: yield* lowerMessages(request),
    stream: true as const,
    // Full-history replay need not create retained provider resources. Continuation callers opt in to storage.
    store: options.store ?? false,
    previous_interaction_id: options.previousInteractionId,
    system_instruction: request.system.length ? ProviderShared.joinText(request.system) : undefined,
    service_tier: options.serviceTier,
    safety_settings: options.safetySettings?.map((setting) => ({
      type: setting.category.replace(/^HARM_CATEGORY_/, "").toLowerCase(),
      threshold: setting.threshold.toLowerCase(),
    })),
    tools: definitions.length
      ? definitions.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        }))
      : undefined,
    generation_config: {
      max_output_tokens: request.maxTokens,
      temperature: request.temperature,
      top_p: request.topP,
      seed: request.seed,
      stop_sequences: request.stop,
      thinking_level: options.thinkingLevel,
      thinking_summaries: options.thinkingSummaries,
      tool_choice: choice,
    },
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
const metadata = (state: ParserState, step: OutputStep): ProviderMetadata => ({
  [state.metadataKey]: { interactionSignature: step.signature },
})
const mapUsage = (usage: RawUsage | undefined, key: string, continued: ParserState["continuedUsage"]) => {
  if (!usage && continued.every((hop) => !hop)) return undefined
  const first = continued.length ? continued[0] : usage
  const hops = [...continued, usage]
  const sum = (field: (hop: RawUsage) => number | null | undefined) =>
    ProviderShared.sumTokens(...hops.map((hop) => (hop ? (field(hop) ?? undefined) : undefined)))
  const input = first?.total_input_tokens ?? undefined
  const cached = first?.total_cached_tokens ?? undefined
  const reasoning = sum((hop) => hop.total_thought_tokens)
  const text = sum((hop) => hop.total_output_tokens)
  const output = continued.length
    ? ProviderShared.sumTokens(text, reasoning)
    : text === undefined
      ? undefined
      : text + (reasoning ?? 0)
  return new Usage({
    contextTokens: first?.raw_prompt_token ?? input,
    inputTokens: input,
    outputTokens: output,
    nonCachedInputTokens: ProviderShared.subtractTokens(input, cached),
    cacheReadInputTokens: cached,
    reasoningTokens: reasoning,
    totalTokens: continued.length
      ? ProviderShared.totalTokens(input, output, undefined)
      : (usage?.total_tokens ?? undefined),
    // Keep re-billed input in provider metadata, separate from the logical call's input.
    providerMetadata: {
      [key]: continued.length
        ? {
            total_input_tokens: sum((hop) => hop.total_input_tokens),
            total_cached_tokens: sum((hop) => hop.total_cached_tokens),
            total_output_tokens: text,
            total_thought_tokens: reasoning,
            total_tokens: sum((hop) => hop.total_tokens),
            requests: hops.length,
          }
        : (usage ?? {}),
    },
  })
}

const blockID = (state: ParserState, index: number) => (state.hop === 0 ? String(index) : `${state.hop}:${index}`)

const onStart = Effect.fnUntraced(function* (state: ParserState, index: number, step: OutputStep) {
  const events: LLMEvent[] = []
  let lifecycle = Lifecycle.stepStart(state.lifecycle, events)
  let tools = state.tools
  const id = blockID(state, index)
  if (step.type === "thought") {
    lifecycle = Lifecycle.reasoningStart(lifecycle, events, id, metadata(state, step))
    for (const part of step.summary ?? []) lifecycle = Lifecycle.reasoningDelta(lifecycle, events, id, part.text)
  } else if (step.type === "model_output") {
    lifecycle = Lifecycle.textStart(lifecycle, events, id)
    for (const part of step.content ?? []) {
      if (part.type !== "text")
        return yield* ProviderShared.eventError(
          ADAPTER,
          `Unsupported Interactions output: ${part.type}`,
          encodeJson(step),
        )
      if (part.text) lifecycle = Lifecycle.textDelta(lifecycle, events, id, part.text)
    }
  } else if (step.type === "function_call") {
    if (!step.id || !step.name)
      return yield* ProviderShared.eventError(ADAPTER, "Interactions function call lacks id or name", encodeJson(step))
    tools = ToolStream.start(tools, index, {
      id: step.id,
      name: step.name,
      providerMetadata: metadata(state, step),
      input: step.arguments && Object.keys(step.arguments).length ? encodeJson(step.arguments) : "",
    })
    events.push(LLMEvent.toolInputStart({ id: step.id, name: step.name, providerMetadata: metadata(state, step) }))
  } else
    return yield* ProviderShared.eventError(ADAPTER, `Unsupported Interactions step: ${step.type}`, encodeJson(step))
  return [
    {
      ...state,
      lifecycle,
      tools,
      hasToolCalls: state.hasToolCalls || step.type === "function_call",
      steps: { ...state.steps, [index]: step },
    },
    events,
  ] satisfies StepResult
})

const onDelta = Effect.fnUntraced(function* (state: ParserState, index: number, delta: typeof Delta.Type) {
  const step = state.steps[index]
  if (!step)
    return yield* ProviderShared.eventError(ADAPTER, "Interactions delta without step.start", encodeJson(delta))
  const events: LLMEvent[] = []
  if (delta.type === "text" && step.type === "model_output")
    return [
      { ...state, lifecycle: Lifecycle.textDelta(state.lifecycle, events, blockID(state, index), delta.text) },
      events,
    ] satisfies StepResult
  if (delta.type === "thought_summary" && step.type === "thought")
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, blockID(state, index), delta.content.text),
      },
      events,
    ] satisfies StepResult
  if (delta.type === "thought_signature") {
    const next = { ...step, signature: delta.signature }
    const tool = state.tools[index]
    return [
      {
        ...state,
        steps: { ...state.steps, [index]: next },
        tools: tool ? { ...state.tools, [index]: { ...tool, providerMetadata: metadata(state, next) } } : state.tools,
      },
      events,
    ] satisfies StepResult
  }
  if (delta.type === "arguments_delta" && step.type === "function_call") {
    const result = ToolStream.appendExisting(
      ADAPTER,
      state.tools,
      index,
      delta.arguments,
      "Interactions arguments without function call",
    )
    if (ToolStream.isError(result)) return yield* result
    return [{ ...state, tools: result.tools }, result.events] satisfies StepResult
  }
  return yield* ProviderShared.eventError(
    ADAPTER,
    `Unsupported Interactions delta: ${delta.type === "unknown" ? delta.rawType : delta.type}`,
    encodeJson(delta),
  )
})

const onStop = Effect.fnUntraced(function* (state: ParserState, index: number) {
  const step = state.steps[index]
  if (!step) return yield* ProviderShared.eventError(ADAPTER, "Interactions step.stop without step.start")
  const events: LLMEvent[] = []
  if (step.type === "thought")
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningEnd(state.lifecycle, events, blockID(state, index), metadata(state, step)),
      },
      events,
    ] satisfies StepResult
  if (step.type === "model_output")
    return [
      { ...state, lifecycle: Lifecycle.textEnd(state.lifecycle, events, blockID(state, index)) },
      events,
    ] satisfies StepResult
  const result = yield* ToolStream.finish(ADAPTER, state.tools, index)
  return [{ ...state, tools: result.tools }, result.events ?? []] satisfies StepResult
})

const RECOVERABLE_CODES = new Set([
  "MALFORMED_FUNCTION_CALL",
  "MALFORMED_TOOL_CALL",
  "UNEXPECTED_TOOL_CALL",
  "MALFORMED_RESPONSE",
])
const INVALID_OUTPUT_CODES = new Set(["MISSING_THOUGHT_SIGNATURE", "TOO_MANY_TOOL_CALLS", "NO_IMAGE"])

const failureReason = (route: string, code: string | undefined, message: string, data: unknown, rawBody: string) => {
  const normalized = code?.trim().toUpperCase().replaceAll("-", "_")
  if (normalized && RECOVERABLE_CODES.has(normalized))
    return new InvalidProviderOutputError({ route, message, body: rawBody, classification: "incomplete-stream" })
  if (normalized && INVALID_OUTPUT_CODES.has(normalized))
    return new InvalidProviderOutputError({ route, message, body: rawBody })
  if (normalized && (normalized === "CONTENT_BLOCKED" || GeminiGenerateContent.contentFiltered(normalized)))
    return new ContentPolicyError({ message, body: rawBody })
  return classifyProviderFailure({ message, data, rawBody })
}

// Marks a request boundary without adding another logical LLM step or finish.
class NextRequest {}

const step = Effect.fnUntraced(function* (state: ParserState, event: Event | NextRequest) {
  if (event instanceof NextRequest) {
    const pending = yield* ToolStream.finishAll(ADAPTER, state.tools)
    const events = [...pending.events]
    let lifecycle = state.lifecycle
    for (const [index, step] of Object.entries(state.steps)) {
      const id = blockID(state, Number(index))
      if (step?.type === "thought") lifecycle = Lifecycle.reasoningEnd(lifecycle, events, id, metadata(state, step))
      if (step?.type === "model_output") lifecycle = Lifecycle.textEnd(lifecycle, events, id)
    }
    return [
      {
        ...state,
        hop: state.hop + 1,
        lifecycle,
        steps: {},
        tools: ToolStream.empty<number>(),
        usage: undefined,
        continuedUsage: [...state.continuedUsage, state.usage],
      },
      events,
    ] satisfies StepResult
  }
  switch (event.event_type) {
    case "step.start":
      return yield* onStart(state, event.index, event.step)
    case "step.delta":
      return yield* onDelta(state, event.index, event.delta)
    case "step.stop":
      return yield* onStop(state, event.index)
    case "interaction.status_update":
      return [{ ...state, usage: event.usage ?? state.usage }, []] satisfies StepResult
    case "interaction.created":
    case "unknown":
      return [state, []] satisfies StepResult
    case "error": {
      const rawBody = encodeJson(event)
      const detail = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorDetail)(event.error))
      return yield* new AIError({
        reason: failureReason(
          state.route,
          detail?.code ?? detail?.error_type,
          detail?.message?.trim() || providerErrorMessage(rawBody) || "Google Interactions stream error",
          event.error,
          rawBody,
        ),
      })
    }
    case "interaction.completed": {
      const interaction = event.interaction
      if (interaction.status === CONTINUATION)
        return [{ ...state, usage: interaction.usage ?? state.usage }, []] satisfies StepResult
      if (interaction.status === "failed" || interaction.status === "cancelled") {
        const messages = (interaction.errors ?? []).flatMap((error) => (error.message?.trim() ? [error.message] : []))
        const coded = interaction.errors?.find((error) => error.code)
        return yield* new AIError({
          reason: failureReason(
            state.route,
            coded?.code,
            messages.length > 0 ? messages.join("\n") : `Google Interactions ${interaction.status}`,
            // The first coded error decides the classification; every message stays visible.
            coded ?? interaction,
            encodeJson(event),
          ),
        })
      }
      if (!["completed", "requires_action", "incomplete"].includes(interaction.status))
        return yield* ProviderShared.eventError(
          ADAPTER,
          `Unexpected terminal Interactions status: ${interaction.status}`,
          encodeJson(event),
        )
      const pending = yield* ToolStream.finishAll(ADAPTER, state.tools)
      const events = [...pending.events]
      const lifecycle = Lifecycle.finish(state.lifecycle, events, {
        reason: {
          normalized:
            interaction.status === "requires_action" || (interaction.status === "completed" && state.hasToolCalls)
              ? "tool-calls"
              : interaction.status === "incomplete"
                ? "length"
                : "stop",
          raw: interaction.status,
        },
        usage: mapUsage(interaction.usage ?? state.usage, state.metadataKey, state.continuedUsage),
        providerMetadata: { [state.metadataKey]: { interactionId: interaction.id } },
      })
      return [{ ...state, lifecycle, tools: pending.tools }, events] satisfies StepResult
    }
  }
})

// =============================================================================
// Transport
// =============================================================================
type Body = typeof Body.Type
export interface Prepared {
  readonly http: HttpTransport.HttpPrepared<string>
  readonly input: TransportPrepareInput<Body>
}

interface Resume {
  readonly token: string
  readonly owner?: string
  readonly reconnectsWithoutProgress: number
  readonly lastError?: AIError
}

const sse = HttpTransport.sseJson.with<Body>()
const WireEvent = Protocol.jsonEvent(Event)
const decodeEvent = Schema.decodeUnknownEffect(WireEvent)

export const transport: Transport<Body, Prepared, Event | NextRequest> = {
  id: sse.id,
  prepare: (input) => sse.prepare(input).pipe(Effect.map((http) => ({ http, input }))),
  execute: (prepared, request, runtime) =>
    Effect.gen(function* () {
      const label = `${request.model.provider}/${request.model.route.id}`
      const raw = new WeakMap<object, string>()
      const respond = (
        execution: TransportExecution<string>,
        resume?: Resume,
      ): Stream.Stream<Event | NextRequest, AIError> =>
        Stream.suspend(() => {
          let token = resume?.token
          let owner: string | undefined
          let status: string | undefined
          let contentSinceToken = false
          let terminal = false
          let dropped: AIError | undefined
          const pendingTools = new Set<number>()
          return execution.frames.pipe(
            Stream.mapEffect((frame) =>
              decodeEvent(frame).pipe(
                Effect.mapError((cause) =>
                  ProviderShared.eventError(ADAPTER, `Invalid ${label} stream event`, frame, cause),
                ),
                Effect.map((event) => {
                  raw.set(event, frame)
                  switch (event.event_type) {
                    case "interaction.created":
                      owner = event.interaction.id
                      break
                    case "interaction.status_update":
                      status = event.status
                      owner = event.interaction_id ?? owner
                      if (event.continuation_token && event.continuation_token !== token) {
                        token = event.continuation_token
                        contentSinceToken = false
                      }
                      break
                    case "interaction.completed":
                      terminal = true
                      status = event.interaction.status
                      owner = event.interaction.id ?? owner
                      if (event.interaction.continuation_token) {
                        token = event.interaction.continuation_token
                        contentSinceToken = false
                      }
                      break
                    case "step.start":
                      if (event.step.type === "function_call") pendingTools.add(event.index)
                      if (
                        pendingTools.has(event.index) ||
                        event.step.content?.length ||
                        event.step.summary?.length ||
                        event.step.signature
                      )
                        contentSinceToken = true
                      break
                    case "step.delta":
                      contentSinceToken = true
                      break
                    case "step.stop":
                      if (pendingTools.delete(event.index)) contentSinceToken = true
                      break
                  }
                  return event
                }),
              ),
            ),
            Stream.takeUntil((event) => event.event_type === "interaction.completed"),
            Stream.catchIf(
              (error) => error.reason._tag === "Transport" && error.reason.code !== "Timeout",
              (error) => {
                dropped = error
                return Stream.empty
              },
            ),
            Stream.concat(
              Stream.suspend(() => {
                const needsContinuation = status === CONTINUATION
                const resumable = needsContinuation || (!terminal && (status === undefined || status === "in_progress"))
                const newToken = token !== resume?.token
                // An interrupted tool call may carry arguments across the checkpoint. Don't finalize it on EOF.
                if (
                  token &&
                  resumable &&
                  !contentSinceToken &&
                  (terminal || pendingTools.size === 0) &&
                  (!needsContinuation || newToken)
                ) {
                  const reconnectsWithoutProgress = newToken ? 0 : (resume?.reconnectsWithoutProgress ?? 0) + 1
                  const lastError = dropped ?? (newToken ? undefined : resume?.lastError)
                  if (reconnectsWithoutProgress > MAX_STREAM_RECONNECTS_WITHOUT_PROGRESS) {
                    if (!lastError) return Stream.empty
                    return Stream.fail(
                      new AIError({
                        reason: new InvalidProviderOutputError({
                          route: label,
                          message: lastError.reason.message,
                          classification: "incomplete-stream",
                          cause: lastError,
                          http: lastError.reason.http,
                        }),
                      }),
                    )
                  }
                  return Stream.concat(
                    Stream.succeed(new NextRequest()),
                    next({ token, owner: newToken ? owner : resume?.owner, reconnectsWithoutProgress, lastError }),
                  )
                }
                if (dropped) return Stream.fail(dropped)
                if (terminal && needsContinuation && !token)
                  return Stream.fail(ProviderShared.eventError(label, "Google Interactions continued without a token"))
                // No safe checkpoint. Leave EOF for the route's incomplete-stream check.
                return Stream.empty
              }),
            ),
          )
        })
      const next = (resume: Resume) => {
        const body = prepared.input.body
        return Stream.unwrap(
          sse
            .prepare({
              ...prepared.input,
              body: {
                ...body,
                continuation_token: resume.token,
                ...(body.store && resume.owner ? { input: undefined, previous_interaction_id: resume.owner } : {}),
              },
            })
            .pipe(
              Effect.flatMap((continued) => sse.execute(continued, request, runtime)),
              Effect.map((execution) => respond(execution, resume)),
            ),
        )
      }
      const first = yield* sse.execute(prepared.http, request, runtime)
      return {
        frames: respond(first),
        http: first.http,
        body: (frame) => raw.get(frame),
        raw: (frame) => {
          const body = raw.get(frame)
          return body === undefined ? undefined : ProviderShared.decodeJson(body)
        },
      }
    }),
}

// =============================================================================
// Protocol And Route
// =============================================================================
export const protocol = Protocol.make({
  id: ADAPTER,
  sanitizer: "gemini",
  body: { schema: Body, from: fromRequest },
  stream: {
    event: Schema.Union([Schema.instanceOf(NextRequest), Schema.toType(Event), WireEvent]),
    initial: (request): ParserState => ({
      route: `${request.model.provider}/${request.model.route.id}`,
      metadataKey: request.model.route.providerMetadataKey ?? request.model.provider,
      lifecycle: Lifecycle.initial(),
      hop: 0,
      hasToolCalls: false,
      continuedUsage: [],
      steps: {},
      tools: ToolStream.empty<number>(),
    }),
    step,
    terminal: (event) =>
      !(event instanceof NextRequest) &&
      event.event_type === "interaction.completed" &&
      event.interaction.status !== CONTINUATION,
  },
})

export const route = Route.make({
  id: ADAPTER,
  provider: "google",
  providerMetadataKey: "google",
  protocol,
  endpoint: Endpoint.path("/interactions", { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  transport,
})

export * as GoogleInteractions from "./google-interactions.js"
