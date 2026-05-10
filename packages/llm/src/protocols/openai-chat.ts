import { Array as Arr, Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { HttpTransport } from "../route/transport"
import { Protocol } from "../route/protocol"
import {
  LLMEvent,
  Usage,
  type FinishReason,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { isRecord, JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { OpenAIOptions } from "./utils/openai-options"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "openai-chat"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/chat/completions"

// =============================================================================
// Request Body Schema
// =============================================================================
// The body schema is the provider-native JSON body. `fromRequest` below builds
// this shape from the common `LLMRequest`, then `Route.make` validates and
// JSON-encodes it before transport.
const OpenAIChatFunction = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
})

const OpenAIChatTool = Schema.Struct({
  type: Schema.tag("function"),
  function: OpenAIChatFunction,
})
type OpenAIChatTool = Schema.Schema.Type<typeof OpenAIChatTool>

const OpenAIChatAssistantToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.tag("function"),
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
})
type OpenAIChatAssistantToolCall = Schema.Schema.Type<typeof OpenAIChatAssistantToolCall>

const OpenAIChatMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.String }),
  Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.NullOr(Schema.String),
    tool_calls: optionalArray(OpenAIChatAssistantToolCall),
    reasoning_content: Schema.optional(Schema.String),
  }),
  Schema.Struct({ role: Schema.Literal("tool"), tool_call_id: Schema.String, content: Schema.String }),
]).pipe(Schema.toTaggedUnion("role"))
type OpenAIChatMessage = Schema.Schema.Type<typeof OpenAIChatMessage>

const OpenAIChatToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({
    type: Schema.tag("function"),
    function: Schema.Struct({ name: Schema.String }),
  }),
])

export const bodyFields = {
  model: Schema.String,
  messages: Schema.Array(OpenAIChatMessage),
  tools: optionalArray(OpenAIChatTool),
  tool_choice: Schema.optional(OpenAIChatToolChoice),
  stream: Schema.Literal(true),
  stream_options: Schema.optional(Schema.Struct({ include_usage: Schema.Boolean })),
  store: Schema.optional(Schema.Boolean),
  reasoning_effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
  max_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  frequency_penalty: Schema.optional(Schema.Number),
  presence_penalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: optionalArray(Schema.String),
}
const OpenAIChatBody = Schema.Struct(bodyFields)
export type OpenAIChatBody = Schema.Schema.Type<typeof OpenAIChatBody>

// =============================================================================
// Streaming Event Schema
// =============================================================================
// The event schema is one decoded SSE `data:` payload. `Framing.sse` splits the
// byte stream into strings, then `Protocol.jsonEvent` decodes each string into
// this provider-native event shape.
const OpenAIChatUsage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
  prompt_tokens_details: optionalNull(
    Schema.Struct({
      cached_tokens: Schema.optional(Schema.Number),
    }),
  ),
  completion_tokens_details: optionalNull(
    Schema.Struct({
      reasoning_tokens: Schema.optional(Schema.Number),
    }),
  ),
})

const OpenAIChatToolCallDeltaFunction = Schema.Struct({
  name: optionalNull(Schema.String),
  arguments: optionalNull(Schema.String),
})

const OpenAIChatToolCallDelta = Schema.Struct({
  index: Schema.Number,
  id: optionalNull(Schema.String),
  function: optionalNull(OpenAIChatToolCallDeltaFunction),
})
type OpenAIChatToolCallDelta = Schema.Schema.Type<typeof OpenAIChatToolCallDelta>

const OpenAIChatDelta = Schema.Struct({
  content: optionalNull(Schema.String),
  tool_calls: optionalNull(Schema.Array(OpenAIChatToolCallDelta)),
})

const OpenAIChatChoice = Schema.Struct({
  delta: optionalNull(OpenAIChatDelta),
  finish_reason: optionalNull(Schema.String),
})

const OpenAIChatEvent = Schema.Struct({
  choices: Schema.Array(OpenAIChatChoice),
  usage: optionalNull(OpenAIChatUsage),
})
type OpenAIChatEvent = Schema.Schema.Type<typeof OpenAIChatEvent>
type OpenAIChatRequestMessage = LLMRequest["messages"][number]

interface ParserState {
  readonly tools: ToolStream.State<number>
  readonly toolCallEvents: ReadonlyArray<LLMEvent>
  readonly usage?: Usage
  readonly finishReason?: FinishReason
}

const invalid = ProviderShared.invalidRequest

// =============================================================================
// Request Lowering
// =============================================================================
// Lowering is the only place that knows how common LLM messages map onto the
// OpenAI Chat wire format. Keep provider quirks here instead of leaking native
// fields into `LLMRequest`.
const lowerTool = (tool: ToolDefinition): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
})

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("OpenAI Chat", toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (name) => ({ type: "function" as const, function: { name } }),
  })

const lowerToolCall = (part: ToolCallPart): OpenAIChatAssistantToolCall => ({
  id: part.id,
  type: "function",
  function: {
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  },
})

const openAICompatibleReasoningContent = (native: unknown) =>
  isRecord(native) && typeof native.reasoning_content === "string" ? native.reasoning_content : undefined

const lowerUserMessage = Effect.fn("OpenAIChat.lowerUserMessage")(function* (message: OpenAIChatRequestMessage) {
  const content: TextPart[] = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["text"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "user", ["text"])
    content.push(part)
  }
  return { role: "user" as const, content: ProviderShared.joinText(content) }
})

const lowerAssistantMessage = Effect.fn("OpenAIChat.lowerAssistantMessage")(function* (
  message: OpenAIChatRequestMessage,
) {
  const content: TextPart[] = []
  const toolCalls: OpenAIChatAssistantToolCall[] = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["text", "tool-call"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "assistant", ["text", "tool-call"])
    if (part.type === "text") {
      content.push(part)
      continue
    }
    if (part.type === "tool-call") {
      toolCalls.push(lowerToolCall(part))
      continue
    }
  }
  return {
    role: "assistant" as const,
    content: content.length === 0 ? null : ProviderShared.joinText(content),
    tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
    reasoning_content: openAICompatibleReasoningContent(message.native?.openaiCompatible),
  }
})

const lowerToolMessages = Effect.fn("OpenAIChat.lowerToolMessages")(function* (message: OpenAIChatRequestMessage) {
  const messages: OpenAIChatMessage[] = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["tool-result"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "tool", ["tool-result"])
    messages.push({ role: "tool", tool_call_id: part.id, content: ProviderShared.toolResultText(part) })
  }
  return messages
})

const lowerMessage = Effect.fn("OpenAIChat.lowerMessage")(function* (message: OpenAIChatRequestMessage) {
  if (message.role === "user") return [yield* lowerUserMessage(message)]
  if (message.role === "assistant") return [yield* lowerAssistantMessage(message)]
  return yield* lowerToolMessages(message)
})

const lowerMessages = Effect.fn("OpenAIChat.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  return [...system, ...Arr.flatten(yield* Effect.forEach(request.messages, lowerMessage))]
})

const lowerOptions = Effect.fn("OpenAIChat.lowerOptions")(function* (request: LLMRequest) {
  const store = OpenAIOptions.store(request)
  const reasoningEffort = OpenAIOptions.reasoningEffort(request)
  if (reasoningEffort && !OpenAIOptions.isReasoningEffort(reasoningEffort))
    return yield* invalid(`OpenAI Chat does not support reasoning effort ${reasoningEffort}`)
  return {
    ...(store !== undefined ? { store } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }
})

const fromRequest = Effect.fn("OpenAIChat.fromRequest")(function* (request: LLMRequest) {
  // `fromRequest` returns the provider body only. Endpoint, auth, framing,
  // validation, and HTTP execution are composed by `Route.make`.
  const generation = request.generation
  return {
    model: request.model.id,
    messages: yield* lowerMessages(request),
    tools: request.tools.length === 0 ? undefined : request.tools.map(lowerTool),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    stream_options: { include_usage: true },
    max_tokens: generation?.maxTokens,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    frequency_penalty: generation?.frequencyPenalty,
    presence_penalty: generation?.presencePenalty,
    seed: generation?.seed,
    stop: generation?.stop,
    ...(yield* lowerOptions(request)),
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
// Streaming parsers are small state machines: every event returns a new state
// plus the common `LLMEvent`s produced by that event. Tool calls are accumulated
// because OpenAI streams JSON arguments across multiple deltas.
const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  if (reason === "content_filter") return "content-filter"
  if (reason === "function_call" || reason === "tool_calls") return "tool-calls"
  return "unknown"
}

const mapUsage = (usage: OpenAIChatEvent["usage"]): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens,
    totalTokens: ProviderShared.totalTokens(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
    native: usage,
  })
}

const step = (state: ParserState, event: OpenAIChatEvent) =>
  Effect.gen(function* () {
    const events: LLMEvent[] = []
    const usage = mapUsage(event.usage) ?? state.usage
    const choice = event.choices[0]
    const finishReason = choice?.finish_reason ? mapFinishReason(choice.finish_reason) : state.finishReason
    const delta = choice?.delta
    const toolDeltas = delta?.tool_calls ?? []
    let tools = state.tools

    if (delta?.content) events.push(LLMEvent.textDelta({ id: "text-0", text: delta.content }))

    for (const tool of toolDeltas) {
      const result = ToolStream.appendOrStart(
        ADAPTER,
        tools,
        tool.index,
        { id: tool.id ?? undefined, name: tool.function?.name ?? undefined, text: tool.function?.arguments ?? "" },
        "OpenAI Chat tool call delta is missing id or name",
      )
      if (ToolStream.isError(result)) return yield* result
      tools = result.tools
      if (result.event) events.push(result.event)
    }

    // Finalize accumulated tool inputs eagerly when finish_reason arrives so
    // JSON parse failures fail the stream at the boundary rather than at halt.
    const finished =
      finishReason !== undefined && state.finishReason === undefined && Object.keys(tools).length > 0
        ? yield* ToolStream.finishAll(ADAPTER, tools)
        : undefined

    return [
      {
        tools: finished?.tools ?? tools,
        toolCallEvents: finished?.events ?? state.toolCallEvents,
        usage,
        finishReason,
      },
      events,
    ] as const
  })

const finishEvents = (state: ParserState): ReadonlyArray<LLMEvent> => {
  const hasToolCalls = state.toolCallEvents.length > 0
  const reason = state.finishReason === "stop" && hasToolCalls ? "tool-calls" : state.finishReason
  return [
    ...state.toolCallEvents,
    ...(reason ? [LLMEvent.requestFinish({ reason, usage: state.usage })] : []),
  ]
}

// =============================================================================
// Protocol And OpenAI Route
// =============================================================================
/**
 * The OpenAI Chat protocol — request body construction, body schema, and the
 * streaming-event state machine. Reused by every route that speaks OpenAI Chat
 * over HTTP+SSE: native OpenAI, DeepSeek, TogetherAI, Cerebras, Baseten,
 * Fireworks, DeepInfra, and (once added) Azure OpenAI Chat.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIChatBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(OpenAIChatEvent),
    initial: () => ({ tools: ToolStream.empty<number>(), toolCallEvents: [] }),
    step,
    onHalt: finishEvents,
  },
})

const encodeBody = Schema.encodeSync(Schema.fromJsonString(OpenAIChatBody))

export const httpTransport = HttpTransport.httpJson({
  endpoint: Endpoint.path(PATH),
  auth: Auth.bearer(),
  framing: Framing.sse,
  encodeBody,
})

export const route = Route.make({
  id: ADAPTER,
  provider: "openai",
  protocol,
  transport: httpTransport,
  defaults: {
    baseURL: DEFAULT_BASE_URL,
  },
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = route.model

export * as OpenAIChat from "./openai-chat"
