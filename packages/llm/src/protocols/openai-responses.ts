import { Effect, Schema, Stream } from "effect"
import { Route } from "../route/client"
import { Auth, type Auth as AuthDef } from "../route/auth"
import { Endpoint, type Endpoint as EndpointConfig } from "../route/endpoint"
import { Framing } from "../route/framing"
import { HttpTransport } from "../route/transport"
import type { Transport } from "../route/transport"
import { capabilities } from "../llm"
import { Protocol } from "../route/protocol"
import {
  LLMError,
  TransportReason,
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
const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const PATH = "/responses"

// =============================================================================
// Request Body Schema
// =============================================================================
const OpenAIResponsesInputText = Schema.Struct({
  type: Schema.Literal("input_text"),
  text: Schema.String,
})

const OpenAIResponsesOutputText = Schema.Struct({
  type: Schema.Literal("output_text"),
  text: Schema.String,
})

const OpenAIResponsesInputItem = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Array(OpenAIResponsesInputText) }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Array(OpenAIResponsesOutputText) }),
  Schema.Struct({
    type: Schema.Literal("function_call"),
    call_id: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("function_call_output"),
    call_id: Schema.String,
    output: Schema.String,
  }),
])
type OpenAIResponsesInputItem = Schema.Schema.Type<typeof OpenAIResponsesInputItem>

const OpenAIResponsesTool = Schema.Struct({
  type: Schema.Literal("function"),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
})
type OpenAIResponsesTool = Schema.Schema.Type<typeof OpenAIResponsesTool>

const OpenAIResponsesToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({ type: Schema.Literal("function"), name: Schema.String }),
])

const OpenAIResponsesBodyFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  tools: optionalArray(OpenAIResponsesTool),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  stream: Schema.Literal(true),
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
const OpenAIResponsesBody = Schema.Struct(OpenAIResponsesBodyFields)
export type OpenAIResponsesBody = Schema.Schema.Type<typeof OpenAIResponsesBody>

const { stream: _stream, ...OpenAIResponsesWebSocketMessageFields } = OpenAIResponsesBodyFields
const OpenAIResponsesWebSocketMessage = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.Literal("response.create"),
    ...OpenAIResponsesWebSocketMessageFields,
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

// Hosted tool items (provider-executed) ship their typed input + status + result
// fields all in one item. We expose them as a `tool-call` + `tool-result` pair
// so consumers can treat them uniformly with client tools, only differentiated
// by `providerExecuted: true`.
//
// item.type → tool name. Each entry is the OpenAI Responses item type that
// represents a hosted (provider-executed) tool call.
const HOSTED_TOOL_NAMES: Record<string, string> = {
  web_search_call: "web_search",
  web_search_preview_call: "web_search_preview",
  file_search_call: "file_search",
  code_interpreter_call: "code_interpreter",
  computer_use_call: "computer_use",
  image_generation_call: "image_generation",
  mcp_call: "mcp",
  local_shell_call: "local_shell",
}

const isHostedToolItem = (item: OpenAIResponsesStreamItem): item is OpenAIResponsesStreamItem & { id: string } =>
  item.type in HOSTED_TOOL_NAMES && typeof item.id === "string" && item.id.length > 0

// Pick the input fields the model actually populated when invoking the tool.
// The shape is tool-specific. Keep this list explicit so each tool's input is
// reviewable at a glance — fall back to `{}` for tools we haven't typed yet.
const hostedToolInput = (item: OpenAIResponsesStreamItem): unknown => {
  if (item.type === "web_search_call" || item.type === "web_search_preview_call") return item.action ?? {}
  if (item.type === "file_search_call") return { queries: item.queries ?? [] }
  if (item.type === "code_interpreter_call") return { code: item.code, container_id: item.container_id }
  if (item.type === "computer_use_call") return item.action ?? {}
  if (item.type === "local_shell_call") return item.action ?? {}
  if (item.type === "mcp_call") return { server_label: item.server_label, name: item.name, arguments: item.arguments }
  return {}
}

// Round-trip the full item as the structured result so consumers can extract
// outputs / sources / status without re-decoding.
const hostedToolResult = (item: OpenAIResponsesStreamItem) => {
  const isError = typeof item.error !== "undefined" && item.error !== null
  return isError ? { type: "error" as const, value: item.error } : { type: "json" as const, value: item }
}

const hostedToolEvents = (item: OpenAIResponsesStreamItem & { id: string }): ReadonlyArray<LLMEvent> => {
  const name = HOSTED_TOOL_NAMES[item.type]
  const providerMetadata = openaiMetadata({ itemId: item.id })
  return [
    { type: "tool-call", id: item.id, name, input: hostedToolInput(item), providerExecuted: true, providerMetadata },
    {
      type: "tool-result",
      id: item.id,
      name,
      result: hostedToolResult(item),
      providerExecuted: true,
      providerMetadata,
    },
  ]
}

const step = (state: ParserState, event: OpenAIResponsesEvent) =>
  Effect.gen(function* () {
    if (event.type === "response.output_text.delta" && event.delta) {
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
      ] as const
    }

    if (event.type === "response.output_item.added" && event.item?.type === "function_call" && event.item.id) {
      return [
        {
          hasFunctionCall: state.hasFunctionCall,
          tools: ToolStream.start(state.tools, event.item.id, {
            id: event.item.call_id ?? event.item.id,
            name: event.item.name ?? "",
            input: event.item.arguments ?? "",
            providerMetadata: openaiMetadata({ itemId: event.item.id }),
          }),
        },
        [],
      ] as const
    }

    if (event.type === "response.function_call_arguments.delta" && event.item_id && event.delta) {
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
        result.event ? [result.event] : [],
      ] as const
    }

    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      if (!event.item.id || !event.item.call_id || !event.item.name) return [state, []] as const
      const tools = state.tools[event.item.id]
        ? state.tools
        : ToolStream.start(state.tools, event.item.id, { id: event.item.call_id, name: event.item.name })
      const result =
        event.item.arguments === undefined
          ? yield* ToolStream.finish(ADAPTER, tools, event.item.id)
          : yield* ToolStream.finishWithInput(ADAPTER, tools, event.item.id, event.item.arguments)
      return [
        {
          hasFunctionCall: result.event ? true : state.hasFunctionCall,
          tools: result.tools,
        },
        result.event ? [result.event] : [],
      ] as const
    }

    if (event.type === "response.output_item.done" && event.item && isHostedToolItem(event.item)) {
      return [state, hostedToolEvents(event.item)] as const
    }

    if (event.type === "response.completed" || event.type === "response.incomplete")
      return [
        state,
        [
          {
            type: "request-finish" as const,
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
      ] as const

    if (event.type === "error") {
      return [
        state,
        [{ type: "provider-error" as const, message: event.message ?? event.code ?? "OpenAI Responses stream error" }],
      ] as const
    }

    return [state, []] as const
  })

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
    terminal: (event) =>
      event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed",
  },
})

export const endpoint = (
  input: {
    readonly defaultBaseURL?: string | false
    readonly required?: string
  } = {},
) =>
  Endpoint.baseURL<OpenAIResponsesBody>({
    default: input.defaultBaseURL === false ? undefined : (input.defaultBaseURL ?? DEFAULT_BASE_URL),
    path: PATH,
    required: input.required,
  })

const encodeBody = Schema.encodeSync(Schema.fromJsonString(OpenAIResponsesBody))

export const httpTransport = HttpTransport.httpJson({
  endpoint: endpoint(),
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
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
})

type WebSocketPrepared = {
  readonly url: string
  readonly headers: HttpTransport.JsonRequestParts["headers"]
  readonly message: string
}

const webSocketUrl = (value: string) =>
  Effect.gen(function* () {
    const url = new URL(value)
    if (url.protocol === "https:") {
      url.protocol = "wss:"
      return url.toString()
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:"
      return url.toString()
    }
    return yield* Effect.fail(webSocketTransportError(`Unsupported WebSocket URL protocol ${url.protocol}`, value))
  })

const webSocketTransportError = (message: string, url?: string) =>
  new LLMError({
    module: "OpenAIResponses",
    method: "websocket",
    reason: new TransportReason({ message, url, kind: "websocket" }),
  })

const webSocketMessage = (body: string) =>
  ProviderShared.parseJson(ADAPTER, body, "Invalid OpenAI Responses WebSocket request body").pipe(
    Effect.flatMap((parsed) =>
      Effect.gen(function* () {
        if (!ProviderShared.isRecord(parsed))
          return yield* ProviderShared.invalidRequest("OpenAI Responses WebSocket body must be a JSON object")
        return Object.fromEntries(
          Object.entries({ ...parsed, type: "response.create" }).filter(([key]) => key !== "stream"),
        )
      }),
    ),
  )

interface WebSocketTransportInput {
  readonly auth?: AuthDef
  readonly endpoint?: EndpointConfig<OpenAIResponsesBody>
}

interface WebSocketTransport extends Transport<OpenAIResponsesBody, WebSocketPrepared, string> {
  readonly with: (patch: WebSocketTransportInput) => WebSocketTransport
}

const makeWebSocketTransport = (input: WebSocketTransportInput = {}): WebSocketTransport => ({
  id: "websocket-json",
  with: (patch) => makeWebSocketTransport({ ...input, ...patch }),
  prepare: (body, context) =>
    Effect.gen(function* () {
      const parts = yield* HttpTransport.jsonRequestParts({
        body,
        context,
        endpoint: input.endpoint ?? endpoint(),
        auth: input.auth ?? Auth.bearer(),
        encodeBody,
      })
      const message = yield* webSocketMessage(parts.body)
      return {
        url: yield* webSocketUrl(parts.url),
        headers: parts.headers,
        message: encodeWebSocketMessage(message as OpenAIResponsesWebSocketMessage),
      }
    }),
  frames: (prepared, _context, runtime) =>
    Stream.unwrap(
      Effect.gen(function* () {
        if (!runtime.webSocket)
          return yield* webSocketTransportError(
            "OpenAI Responses WebSocket route requires WebSocketExecutor.Service",
            prepared.url,
          )
        const connection = yield* runtime.webSocket.open({ url: prepared.url, headers: prepared.headers })
        yield* connection
          .sendText(prepared.message)
          .pipe(Effect.catch((error: LLMError) => connection.close.pipe(Effect.andThen(Effect.fail(error)))))
        const decoder = new TextDecoder()
        return connection.messages.pipe(
          Stream.map((message) => (typeof message === "string" ? message : decoder.decode(message))),
          Stream.ensuring(connection.close),
        )
      }),
    ),
})

export const webSocketTransport = makeWebSocketTransport()

export const webSocketRoute = Route.make({
  id: `${ADAPTER}-websocket`,
  provider: "openai",
  protocol,
  transport: webSocketTransport,
  defaults: {
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = route.model

export const webSocketModel = webSocketRoute.model

export * as OpenAIResponses from "./openai-responses"
