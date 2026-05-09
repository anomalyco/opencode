import { Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { HttpTransport, WebSocketTransport } from "../route/transport"
import { Protocol } from "../route/protocol"
import {
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type ProviderMetadata,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { OpenAIOptions } from "./utils/openai-options"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "openai-responses"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/responses"

// =============================================================================
// Request Body Schema
// =============================================================================
const OpenAIResponsesInputText = Schema.Struct({
  type: Schema.tag("input_text"),
  text: Schema.String,
})

const OpenAIResponsesOutputText = Schema.Struct({
  type: Schema.tag("output_text"),
  text: Schema.String,
})

const OpenAIResponsesInputItem = Schema.Union([
  Schema.Struct({ role: Schema.tag("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.tag("user"), content: Schema.Array(OpenAIResponsesInputText) }),
  Schema.Struct({ role: Schema.tag("assistant"), content: Schema.Array(OpenAIResponsesOutputText) }),
  Schema.Struct({
    type: Schema.tag("function_call"),
    call_id: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
  }),
  Schema.Struct({
    type: Schema.tag("function_call_output"),
    call_id: Schema.String,
    output: Schema.String,
  }),
])
type OpenAIResponsesInputItem = Schema.Schema.Type<typeof OpenAIResponsesInputItem>

const OpenAIResponsesTool = Schema.Struct({
  type: Schema.tag("function"),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
})
type OpenAIResponsesTool = Schema.Schema.Type<typeof OpenAIResponsesTool>

const OpenAIResponsesToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({ type: Schema.tag("function"), name: Schema.String }),
])

// Fields shared between the HTTP body and the WebSocket `response.create`
// message. The HTTP body adds `stream: true`; the WebSocket message adds
// `type: "response.create"`. Defining the shared shape once keeps the two
// transports in sync without a destructure-and-strip dance.
const OpenAIResponsesCoreFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  tools: optionalArray(OpenAIResponsesTool),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  store: Schema.optional(Schema.Boolean),
  prompt_cache_key: Schema.optional(Schema.String),
  include: optionalArray(Schema.Literal("reasoning.encrypted_content")),
  reasoning: Schema.optional(
    Schema.Struct({
      effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
      summary: Schema.optional(Schema.Literal("auto")),
    }),
  ),
  text: Schema.optional(
    Schema.Struct({
      verbosity: Schema.optional(OpenAIOptions.OpenAITextVerbosity),
    }),
  ),
  max_output_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
}

const OpenAIResponsesBody = Schema.Struct({
  ...OpenAIResponsesCoreFields,
  stream: Schema.Literal(true),
})
export type OpenAIResponsesBody = Schema.Schema.Type<typeof OpenAIResponsesBody>

const OpenAIResponsesWebSocketMessage = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("response.create"),
    ...OpenAIResponsesCoreFields,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type OpenAIResponsesWebSocketMessage = Schema.Schema.Type<typeof OpenAIResponsesWebSocketMessage>
const encodeWebSocketMessage = Schema.encodeSync(Schema.fromJsonString(OpenAIResponsesWebSocketMessage))

const OpenAIResponsesUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  input_tokens_details: optionalNull(Schema.Struct({ cached_tokens: Schema.optional(Schema.Number) })),
  output_tokens: Schema.optional(Schema.Number),
  output_tokens_details: optionalNull(Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) })),
  total_tokens: Schema.optional(Schema.Number),
})
type OpenAIResponsesUsage = Schema.Schema.Type<typeof OpenAIResponsesUsage>

const OpenAIResponsesStreamItem = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  call_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.String),
  // Hosted (provider-executed) tool fields. Each hosted tool item carries its
  // own subset of these — we capture them generically so we can surface the
  // call's typed input portion and round-trip the full result payload without
  // hand-rolling a per-tool schema.
  status: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Unknown),
  queries: Schema.optional(Schema.Unknown),
  results: Schema.optional(Schema.Unknown),
  code: Schema.optional(Schema.String),
  container_id: Schema.optional(Schema.String),
  outputs: Schema.optional(Schema.Unknown),
  server_label: Schema.optional(Schema.String),
  output: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
})
type OpenAIResponsesStreamItem = Schema.Schema.Type<typeof OpenAIResponsesStreamItem>

const OpenAIResponsesEvent = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(Schema.String),
  item_id: Schema.optional(Schema.String),
  item: Schema.optional(OpenAIResponsesStreamItem),
  response: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      service_tier: Schema.optional(Schema.String),
      incomplete_details: optionalNull(Schema.Struct({ reason: Schema.String })),
      usage: optionalNull(OpenAIResponsesUsage),
    }),
  ),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
type OpenAIResponsesEvent = Schema.Schema.Type<typeof OpenAIResponsesEvent>

interface ParserState {
  readonly tools: ToolStream.State<string>
  readonly hasFunctionCall: boolean
}

const invalid = ProviderShared.invalidRequest

// =============================================================================
// Request Lowering
// =============================================================================
const lowerTool = (tool: ToolDefinition): OpenAIResponsesTool => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
})

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("OpenAI Responses", toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (name) => ({ type: "function" as const, name }),
  })

const lowerToolCall = (part: ToolCallPart): OpenAIResponsesInputItem => ({
  type: "function_call",
  call_id: part.id,
  name: part.name,
  arguments: ProviderShared.encodeJson(part.input),
})

const lowerMessages = Effect.fn("OpenAIResponses.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIResponsesInputItem[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  const input: OpenAIResponsesInputItem[] = [...system]

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: TextPart[] = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text"]))
          return yield* ProviderShared.unsupportedContent("OpenAI Responses", "user", ["text"])
        content.push(part)
      }
      input.push({ role: "user", content: content.map((part) => ({ type: "input_text", text: part.text })) })
      continue
    }

    if (message.role === "assistant") {
      const content: TextPart[] = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "tool-call"]))
          return yield* ProviderShared.unsupportedContent("OpenAI Responses", "assistant", ["text", "tool-call"])
        if (part.type === "text") {
          content.push(part)
          continue
        }
        if (part.type === "tool-call") {
          input.push(lowerToolCall(part))
          continue
        }
      }
      if (content.length > 0)
        input.push({ role: "assistant", content: content.map((part) => ({ type: "output_text", text: part.text })) })
      continue
    }

    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent("OpenAI Responses", "tool", ["tool-result"])
      input.push({ type: "function_call_output", call_id: part.id, output: ProviderShared.toolResultText(part) })
    }
  }

  return input
})

const lowerOptions = Effect.fn("OpenAIResponses.lowerOptions")(function* (request: LLMRequest) {
  const store = OpenAIOptions.store(request)
  const promptCacheKey = OpenAIOptions.promptCacheKey(request)
  const effort = OpenAIOptions.reasoningEffort(request)
  if (effort && !OpenAIOptions.isReasoningEffort(effort))
    return yield* invalid(`OpenAI Responses does not support reasoning effort ${effort}`)
  const summary = OpenAIOptions.reasoningSummary(request)
  const encryptedState = OpenAIOptions.encryptedReasoning(request)
  const verbosity = OpenAIOptions.textVerbosity(request)
  return {
    ...(store !== undefined ? { store } : {}),
    ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
    ...(encryptedState ? { include: ["reasoning.encrypted_content"] as const } : {}),
    ...(effort || summary ? { reasoning: { effort, summary } } : {}),
    ...(verbosity ? { text: { verbosity } } : {}),
  }
})

const fromRequest = Effect.fn("OpenAIResponses.fromRequest")(function* (request: LLMRequest) {
  const generation = request.generation
  return {
    model: request.model.id,
    input: yield* lowerMessages(request),
    tools: request.tools.length === 0 ? undefined : request.tools.map(lowerTool),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    max_output_tokens: generation?.maxTokens,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    ...(yield* lowerOptions(request)),
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
const mapUsage = (usage: OpenAIResponsesUsage | null | undefined) => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    cacheReadInputTokens: usage.input_tokens_details?.cached_tokens,
    totalTokens: ProviderShared.totalTokens(usage.input_tokens, usage.output_tokens, usage.total_tokens),
    native: usage,
  })
}

const mapFinishReason = (event: OpenAIResponsesEvent, hasFunctionCall: boolean): FinishReason => {
  const reason = event.response?.incomplete_details?.reason
  if (reason === undefined || reason === null) return hasFunctionCall ? "tool-calls" : "stop"
  if (reason === "max_output_tokens") return "length"
  if (reason === "content_filter") return "content-filter"
  return hasFunctionCall ? "tool-calls" : "unknown"
}

const openaiMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ openai: metadata })

// Hosted tool items (provider-executed) ship their typed input + status +
// result fields all in one item. We expose them as a `tool-call` +
// `tool-result` pair so consumers can treat them uniformly with client tools,
// only differentiated by `providerExecuted: true`.
//
// One record per OpenAI Responses item type that represents a hosted
// (provider-executed) tool call: the common name we surface, plus an `input`
// extractor that picks the fields the model actually populated for that tool.
// Falling back to `{}` when an entry isn't fully typed keeps unknown tools
// observable without rolling a per-tool schema.
const HOSTED_TOOLS = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  web_search_preview_call: { name: "web_search_preview", input: (item) => item.action ?? {} },
  file_search_call: { name: "file_search", input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: "code_interpreter",
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  computer_use_call: { name: "computer_use", input: (item) => item.action ?? {} },
  image_generation_call: { name: "image_generation", input: () => ({}) },
  mcp_call: {
    name: "mcp",
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
  local_shell_call: { name: "local_shell", input: (item) => item.action ?? {} },
} as const satisfies Record<
  string,
  { readonly name: string; readonly input: (item: OpenAIResponsesStreamItem) => unknown }
>

type HostedToolType = keyof typeof HOSTED_TOOLS

const isHostedToolItem = (
  item: OpenAIResponsesStreamItem,
): item is OpenAIResponsesStreamItem & { type: HostedToolType; id: string } =>
  item.type in HOSTED_TOOLS && typeof item.id === "string" && item.id.length > 0

// Round-trip the full item as the structured result so consumers can extract
// outputs / sources / status without re-decoding.
const hostedToolResult = (item: OpenAIResponsesStreamItem) => {
  const isError = typeof item.error !== "undefined" && item.error !== null
  return isError ? { type: "error" as const, value: item.error } : { type: "json" as const, value: item }
}

const hostedToolEvents = (
  item: OpenAIResponsesStreamItem & { type: HostedToolType; id: string },
): ReadonlyArray<LLMEvent> => {
  const tool = HOSTED_TOOLS[item.type]
  const providerMetadata = openaiMetadata({ itemId: item.id })
  return [
    {
      type: "tool-call",
      id: item.id,
      name: tool.name,
      input: tool.input(item),
      providerExecuted: true,
      providerMetadata,
    },
    {
      type: "tool-result",
      id: item.id,
      name: tool.name,
      result: hostedToolResult(item),
      providerExecuted: true,
      providerMetadata,
    },
  ]
}

type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>]

const NO_EVENTS: StepResult["1"] = []

// `response.completed` / `response.incomplete` are clean finishes that emit a
// `request-finish` event; `response.failed` is a hard failure that emits a
// `provider-error`. All three end the stream — kept in one set so `step` and
// the protocol's `terminal` predicate stay in sync.
const TERMINAL_TYPES = new Set(["response.completed", "response.incomplete", "response.failed"])

const onOutputTextDelta = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  if (!event.delta) return [state, NO_EVENTS]
  return [
    state,
    [
      {
        type: "text-delta",
        id: event.item_id,
        text: event.delta,
        ...(event.item_id ? { providerMetadata: openaiMetadata({ itemId: event.item_id }) } : {}),
      },
    ],
  ]
}

const onOutputItemAdded = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  const item = event.item
  if (item?.type !== "function_call" || !item.id) return [state, NO_EVENTS]
  return [
    {
      hasFunctionCall: state.hasFunctionCall,
      tools: ToolStream.start(state.tools, item.id, {
        id: item.call_id ?? item.id,
        name: item.name ?? "",
        input: item.arguments ?? "",
        providerMetadata: openaiMetadata({ itemId: item.id }),
      }),
    },
    NO_EVENTS,
  ]
}

const onFunctionCallArgumentsDelta = Effect.fn("OpenAIResponses.onFunctionCallArgumentsDelta")(function* (
  state: ParserState,
  event: OpenAIResponsesEvent,
) {
  if (!event.item_id || !event.delta) return [state, NO_EVENTS] satisfies StepResult
  const result = ToolStream.appendExisting(
    ADAPTER,
    state.tools,
    event.item_id,
    event.delta,
    "OpenAI Responses tool argument delta is missing its tool call",
  )
  if (ToolStream.isError(result)) return yield* result
  return [
    { hasFunctionCall: state.hasFunctionCall, tools: result.tools },
    result.event ? [result.event] : NO_EVENTS,
  ] satisfies StepResult
})

const onOutputItemDone = Effect.fn("OpenAIResponses.onOutputItemDone")(function* (
  state: ParserState,
  event: OpenAIResponsesEvent,
) {
  const item = event.item
  if (!item) return [state, NO_EVENTS] satisfies StepResult

  if (item.type === "function_call") {
    if (!item.id || !item.call_id || !item.name) return [state, NO_EVENTS] satisfies StepResult
    const tools = state.tools[item.id]
      ? state.tools
      : ToolStream.start(state.tools, item.id, { id: item.call_id, name: item.name })
    const result =
      item.arguments === undefined
        ? yield* ToolStream.finish(ADAPTER, tools, item.id)
        : yield* ToolStream.finishWithInput(ADAPTER, tools, item.id, item.arguments)
    return [
      { hasFunctionCall: result.event ? true : state.hasFunctionCall, tools: result.tools },
      result.event ? [result.event] : NO_EVENTS,
    ] satisfies StepResult
  }

  if (isHostedToolItem(item)) return [state, hostedToolEvents(item)] satisfies StepResult

  return [state, NO_EVENTS] satisfies StepResult
})

const onResponseFinish = (state: ParserState, event: OpenAIResponsesEvent): StepResult => [
  state,
  [
    {
      type: "request-finish",
      reason: mapFinishReason(event, state.hasFunctionCall),
      usage: mapUsage(event.response?.usage),
      ...(event.response?.id || event.response?.service_tier
        ? {
            providerMetadata: openaiMetadata({
              responseId: event.response.id,
              serviceTier: event.response.service_tier,
            }),
          }
        : {}),
    },
  ],
]

const onResponseFailed = (state: ParserState, event: OpenAIResponsesEvent): StepResult => [
  state,
  [{ type: "provider-error", message: event.message ?? event.code ?? "OpenAI Responses response failed" }],
]

const onError = (state: ParserState, event: OpenAIResponsesEvent): StepResult => [
  state,
  [{ type: "provider-error", message: event.message ?? event.code ?? "OpenAI Responses stream error" }],
]

const step = (state: ParserState, event: OpenAIResponsesEvent) => {
  if (event.type === "response.output_text.delta") return Effect.succeed(onOutputTextDelta(state, event))
  if (event.type === "response.output_item.added") return Effect.succeed(onOutputItemAdded(state, event))
  if (event.type === "response.function_call_arguments.delta") return onFunctionCallArgumentsDelta(state, event)
  if (event.type === "response.output_item.done") return onOutputItemDone(state, event)
  if (event.type === "response.completed" || event.type === "response.incomplete")
    return Effect.succeed(onResponseFinish(state, event))
  if (event.type === "response.failed") return Effect.succeed(onResponseFailed(state, event))
  if (event.type === "error") return Effect.succeed(onError(state, event))
  return Effect.succeed<StepResult>([state, NO_EVENTS])
}

// =============================================================================
// Protocol And OpenAI Route
// =============================================================================
/**
 * The OpenAI Responses protocol — request body construction, body schema, and
 * the streaming-event state machine. Used by native OpenAI and (once
 * registered) Azure OpenAI Responses.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIResponsesBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(OpenAIResponsesEvent),
    initial: () => ({ hasFunctionCall: false, tools: ToolStream.empty<string>() }),
    step,
    terminal: (event) => TERMINAL_TYPES.has(event.type),
  },
})

const encodeBody = Schema.encodeSync(Schema.fromJsonString(OpenAIResponsesBody))
const transportBase = {
  endpoint: Endpoint.path<OpenAIResponsesBody>(PATH),
  auth: Auth.bearer(),
  encodeBody,
}
const routeDefaults = {
  baseURL: DEFAULT_BASE_URL,
}

export const httpTransport = HttpTransport.httpJson({
  ...transportBase,
  framing: Framing.sse,
})

export const route = Route.make({
  id: ADAPTER,
  provider: "openai",
  protocol,
  transport: httpTransport,
  defaults: routeDefaults,
})

const decodeWebSocketMessage = ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenAIResponsesWebSocketMessage))

const webSocketMessage = (body: OpenAIResponsesBody | Record<string, unknown>) =>
  Effect.gen(function* () {
    if (!ProviderShared.isRecord(body))
      return yield* ProviderShared.invalidRequest("OpenAI Responses WebSocket body must be a JSON object")
    const { stream: _stream, ...message } = body
    return yield* decodeWebSocketMessage({ ...message, type: "response.create" })
  })

export const webSocketTransport = WebSocketTransport.json({
  ...transportBase,
  toMessage: webSocketMessage,
  encodeMessage: encodeWebSocketMessage,
})

export const webSocketRoute = Route.make({
  id: `${ADAPTER}-websocket`,
  provider: "openai",
  protocol,
  transport: webSocketTransport,
  defaults: routeDefaults,
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = route.model

export const webSocketModel = webSocketRoute.model

export * as OpenAIResponses from "./openai-responses"
