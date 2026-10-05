import { Effect, Schema } from "effect"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import {
  AIError,
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
import { ToolStream } from "./utils/tool-stream.js"

const ADAPTER = "google-interactions"
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
  serviceTier: lenient(knownString<"standard" | "flex" | "priority">()),
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
  input: Schema.Array(InputStep),
  stream: Schema.Literal(true),
  store: Schema.Boolean,
  previous_interaction_id: Schema.optional(Schema.String),
  system_instruction: Schema.optional(Schema.String),
  service_tier: Schema.optional(Schema.String),
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
const Delta = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("arguments_delta"), arguments: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thought_signature"), signature: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thought_summary"), content: Text }),
  // Unknown output modalities must fail explicitly rather than disappearing from a successful response.
  Schema.Struct({ type: Schema.String }),
])
const Interaction = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.optional(Schema.String),
    status: Schema.String,
    usage: Schema.optional(RawUsage),
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
  }),
  Schema.Struct({ event_type: Schema.Literal("interaction.completed"), interaction: Interaction }),
  Schema.Struct({ event_type: Schema.Literal("error"), error: Schema.Unknown }),
])
type Event = typeof Event.Type

// =============================================================================
// Parser State
// =============================================================================
interface ParserState {
  readonly route: string
  readonly metadataKey: string
  readonly lifecycle: Lifecycle.State
  readonly steps: Partial<Record<number, OutputStep>>
  readonly tools: ToolStream.State<number>
  readonly completed: boolean
}
type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>]

// =============================================================================
// Request Body Construction
// =============================================================================
const mediaContent = Effect.fnUntraced(function* (asset: Media.Asset) {
  if (
    asset.kind !== "image" &&
    asset.kind !== "audio" &&
    asset.kind !== "video" &&
    asset.mediaType !== "application/pdf" &&
    asset.mediaType !== "text/csv"
  )
    return yield* ProviderShared.invalidRequest(
      `Google Interactions does not support ${asset.mediaType} document input`,
    )
  const type: (typeof MediaContent.Type)["type"] =
    asset.kind === "image" || asset.kind === "audio" || asset.kind === "video" ? asset.kind : "document"
  const uri = MediaInput.refID(asset, ProviderID.make("google"))
  if (uri !== undefined) return { type, uri, mime_type: asset.mediaType }
  const inline = yield* ProviderShared.requireInlineMedia("Google Interactions", asset)
  return { type, data: inline.base64, mime_type: inline.mime }
})

const signature = (metadata: ProviderMetadata | undefined, key: string) => {
  const value = metadata?.[key]
  return ProviderShared.isRecord(value) && typeof value.interactionSignature === "string"
    ? value.interactionSignature
    : undefined
}

const lowerMessages = Effect.fnUntraced(function* (request: LLMRequest) {
  const steps: InputStep[] = []
  const key = request.model.route.providerMetadataKey ?? String(request.model.provider)
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
        steps.push({
          type: "thought",
          signature: signature(part.providerMetadata, key),
          summary: part.text ? [{ type: "text", text: part.text }] : undefined,
        })
        continue
      }
      if (message.role === "assistant" && part.type === "tool-call") {
        steps.push({
          type: "function_call",
          id: part.id,
          name: part.name,
          arguments: part.input,
          signature: signature(part.providerMetadata, key),
        })
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
    return mediaContent(ProviderShared.toolFileMedia(item).media)
  })
})

const fromRequest = Effect.fn("GoogleInteractions.fromRequest")(function* (request: LLMRequest) {
  const options = yield* decodeOptions(request.providerOptions ?? {})
  const flattened = ProviderShared.flattenToolRequest(request)
  if (flattened.tools.some((tool) => tool.native !== undefined))
    return yield* ProviderShared.invalidRequest("Google Interactions hosted tools are not supported")
  if (
    request.generation?.topK !== undefined ||
    request.generation?.frequencyPenalty !== undefined ||
    request.generation?.presencePenalty !== undefined
  )
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
    input: yield* lowerMessages(flattened.request),
    stream: true as const,
    // Full-history replay need not create retained provider resources. Continuation callers opt in to storage.
    store: options.store ?? false,
    previous_interaction_id: options.previousInteractionId,
    system_instruction: request.system.length ? ProviderShared.joinText(request.system) : undefined,
    service_tier: options.serviceTier,
    tools: flattened.tools.length
      ? flattened.tools.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        }))
      : undefined,
    generation_config: {
      max_output_tokens: request.generation?.maxTokens,
      temperature: request.generation?.temperature,
      top_p: request.generation?.topP,
      seed: request.generation?.seed,
      stop_sequences: request.generation?.stop,
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
const mapUsage = (usage: RawUsage | undefined, key: string) => {
  if (!usage) return undefined
  const input = usage.total_input_tokens ?? undefined
  const cached = usage.total_cached_tokens ?? undefined
  const reasoning = usage.total_thought_tokens ?? undefined
  const output =
    usage.total_output_tokens === undefined || usage.total_output_tokens === null
      ? undefined
      : usage.total_output_tokens + (reasoning ?? 0)
  return new Usage({
    contextTokens: usage.raw_prompt_token ?? input,
    inputTokens: input,
    outputTokens: output,
    nonCachedInputTokens: ProviderShared.subtractTokens(input, cached),
    cacheReadInputTokens: cached,
    reasoningTokens: reasoning,
    totalTokens: usage.total_tokens ?? undefined,
    providerMetadata: { [key]: usage },
  })
}

const onStart = Effect.fnUntraced(function* (
  state: ParserState,
  index: number,
  step: OutputStep,
) {
  const events: LLMEvent[] = []
  let lifecycle = Lifecycle.stepStart(state.lifecycle, events)
  let tools = state.tools
  const id = String(index)
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
  return [{ ...state, lifecycle, tools, steps: { ...state.steps, [index]: step } }, events] satisfies StepResult
})

const onDelta = Effect.fnUntraced(function* (
  state: ParserState,
  index: number,
  delta: typeof Delta.Type,
) {
  const step = state.steps[index]
  if (!step)
    return yield* ProviderShared.eventError(ADAPTER, "Interactions delta without step.start", encodeJson(delta))
  const events: LLMEvent[] = []
  if (delta.type === "text" && "text" in delta && step.type === "model_output")
    return [
      { ...state, lifecycle: Lifecycle.textDelta(state.lifecycle, events, String(index), delta.text) },
      events,
    ] satisfies StepResult
  if (delta.type === "thought_summary" && "content" in delta && step.type === "thought")
    return [
      { ...state, lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, String(index), delta.content.text) },
      events,
    ] satisfies StepResult
  if (delta.type === "thought_signature" && "signature" in delta) {
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
  if (delta.type === "arguments_delta" && "arguments" in delta && step.type === "function_call") {
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
  return yield* ProviderShared.eventError(ADAPTER, `Unsupported Interactions delta: ${delta.type}`, encodeJson(delta))
})

const onStop = Effect.fnUntraced(function* (state: ParserState, index: number) {
  const step = state.steps[index]
  if (!step) return yield* ProviderShared.eventError(ADAPTER, "Interactions step.stop without step.start")
  const events: LLMEvent[] = []
  if (step.type === "thought")
    return [
      { ...state, lifecycle: Lifecycle.reasoningEnd(state.lifecycle, events, String(index), metadata(state, step)) },
      events,
    ] satisfies StepResult
  if (step.type === "model_output")
    return [
      { ...state, lifecycle: Lifecycle.textEnd(state.lifecycle, events, String(index)) },
      events,
    ] satisfies StepResult
  const result = yield* ToolStream.finish(ADAPTER, state.tools, index)
  return [{ ...state, tools: result.tools }, result.events ?? []] satisfies StepResult
})

const step = Effect.fnUntraced(function* (state: ParserState, event: Event) {
  switch (event.event_type) {
    case "step.start":
      return yield* onStart(state, event.index, event.step)
    case "step.delta":
      return yield* onDelta(state, event.index, event.delta)
    case "step.stop":
      return yield* onStop(state, event.index)
    case "interaction.created":
    case "interaction.status_update":
      return [state, []] satisfies StepResult
    case "error":
      return yield* new AIError({
        reason: classifyProviderFailure({
          message: providerErrorMessage(encodeJson(event)) ?? "Google Interactions stream error",
          data: event.error,
          rawBody: encodeJson(event),
        }),
      })
    case "interaction.completed": {
      const interaction = event.interaction
      if (interaction.status === "failed" || interaction.status === "cancelled")
        return yield* new AIError({
          reason: classifyProviderFailure({
            message: `Google Interactions ${interaction.status}`,
            data: interaction,
            rawBody: encodeJson(event),
          }),
        })
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
            interaction.status === "requires_action"
              ? "tool-calls"
              : interaction.status === "incomplete"
                ? "length"
                : "stop",
          raw: interaction.status,
        },
        usage: mapUsage(interaction.usage, state.metadataKey),
        providerMetadata: { [state.metadataKey]: { interactionId: interaction.id } },
      })
      return [{ ...state, lifecycle, tools: pending.tools, completed: true }, events] satisfies StepResult
    }
  }
})

// =============================================================================
// Protocol And Route
// =============================================================================
export const protocol = Protocol.make({
  id: ADAPTER,
  sanitizer: "gemini",
  body: { schema: Body, from: fromRequest },
  stream: {
    event: Protocol.jsonEvent(Event),
    initial: (request): ParserState => ({
      route: `${request.model.provider}/${ADAPTER}`,
      metadataKey: request.model.route.providerMetadataKey ?? String(request.model.provider),
      lifecycle: Lifecycle.initial(),
      steps: {},
      tools: ToolStream.empty<number>(),
      completed: false,
    }),
    step,
    terminal: (event) => event.event_type === "interaction.completed",
    onHalt: (state) =>
      state.completed
        ? Effect.succeed([])
        : Effect.fail(
            ProviderShared.eventError(ADAPTER, "Google Interactions stream ended before interaction.completed"),
          ),
  },
})

export const route = Route.make({
  id: ADAPTER,
  provider: "google",
  providerMetadataKey: "google",
  protocol,
  endpoint: Endpoint.path("/interactions", { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  framing: Framing.sse,
})

export * as GoogleInteractions from "./google-interactions.js"
