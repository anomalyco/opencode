import { Effect, Schema, Stream } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  InvalidRequestError,
  ProviderChunkError,
  TransportRequest,
  Usage,
  type FinishReason,
  type ContentPart,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { sseData } from "../stream"

export type OpenAIChatModelInput = Omit<ModelInput, "provider" | "protocol" | "headers"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

const OpenAIChatFunction = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.Unknown),
})

const OpenAIChatTool = Schema.Struct({
  type: Schema.Literal("function"),
  function: OpenAIChatFunction,
})
type OpenAIChatTool = Schema.Schema.Type<typeof OpenAIChatTool>

const OpenAIChatAssistantToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("function"),
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
    tool_calls: Schema.optional(Schema.Array(OpenAIChatAssistantToolCall)),
  }),
  Schema.Struct({ role: Schema.Literal("tool"), tool_call_id: Schema.String, content: Schema.String }),
])
type OpenAIChatMessage = Schema.Schema.Type<typeof OpenAIChatMessage>

const OpenAIChatToolChoiceFunction = Schema.Struct({ name: Schema.String })

const OpenAIChatToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({
    type: Schema.Literal("function"),
    function: OpenAIChatToolChoiceFunction,
  }),
])

const OpenAIChatTarget = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(OpenAIChatMessage),
  tools: Schema.optional(Schema.Array(OpenAIChatTool)),
  tool_choice: Schema.optional(OpenAIChatToolChoice),
  stream: Schema.Literal(true),
  stream_options: Schema.optional(Schema.Struct({ include_usage: Schema.Boolean })),
  max_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Array(Schema.String)),
})
export type OpenAIChatTarget = Schema.Schema.Type<typeof OpenAIChatTarget>

const OpenAIChatUsage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
  prompt_tokens_details: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        cached_tokens: Schema.optional(Schema.Number),
      }),
    ),
  ),
  completion_tokens_details: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        reasoning_tokens: Schema.optional(Schema.Number),
      }),
    ),
  ),
})

const OpenAIChatToolCallDeltaFunction = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  arguments: Schema.optional(Schema.NullOr(Schema.String)),
})

const OpenAIChatToolCallDelta = Schema.Struct({
  index: Schema.Number,
  id: Schema.optional(Schema.NullOr(Schema.String)),
  function: Schema.optional(Schema.NullOr(OpenAIChatToolCallDeltaFunction)),
})
type OpenAIChatToolCallDelta = Schema.Schema.Type<typeof OpenAIChatToolCallDelta>

const OpenAIChatDelta = Schema.Struct({
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optional(Schema.NullOr(Schema.Array(OpenAIChatToolCallDelta))),
})

const OpenAIChatChoice = Schema.Struct({
  delta: Schema.optional(Schema.NullOr(OpenAIChatDelta)),
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
})

const OpenAIChatChunk = Schema.Struct({
  choices: Schema.Array(OpenAIChatChoice),
  usage: Schema.optional(Schema.NullOr(OpenAIChatUsage)),
})
type OpenAIChatChunk = Schema.Schema.Type<typeof OpenAIChatChunk>

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const encodeJson = Schema.encodeSync(Json)
const OpenAIChatChunkJson = Schema.fromJsonString(OpenAIChatChunk)
const OpenAIChatTargetJson = Schema.fromJsonString(OpenAIChatTarget)
const decodeChunk = Schema.decodeUnknownSync(OpenAIChatChunkJson)
const encodeTarget = Schema.encodeSync(OpenAIChatTargetJson)

interface ToolAccumulator {
  readonly id: string
  readonly name: string
  readonly input: string
}

interface ParserState {
  readonly tools: Record<number, ToolAccumulator>
  readonly usage?: Usage
  readonly finishReason?: FinishReason
}

const decodeTarget = Schema.decodeUnknownEffect(OpenAIChatTarget)

const invalid = (message: string) => new InvalidRequestError({ message })

const baseUrl = (request: LLMRequest) => (request.model.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "")

const text = (values: ReadonlyArray<{ readonly text: string }>) => values.map((part) => part.text).join("\n")

const resultText = (part: ToolResultPart) => {
  if (part.result.type === "text" || part.result.type === "error") return String(part.result.value)
  return encodeJson(part.result.value)
}

const lowerTool = (tool: ToolDefinition): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
})

const lowerToolChoice = (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
): Effect.Effect<NonNullable<OpenAIChatTarget["tool_choice"]>, InvalidRequestError> => {
  if (toolChoice.type === "tool") {
    if (!toolChoice.name) return Effect.fail(invalid(`OpenAI Chat tool choice requires a tool name`))
    return Effect.succeed({ type: "function", function: { name: toolChoice.name } })
  }
  return Effect.succeed(toolChoice.type)
}

const lowerToolCall = (part: ToolCallPart): OpenAIChatAssistantToolCall => ({
  id: part.id,
  type: "function",
  function: {
    name: part.name,
    arguments: encodeJson(part.input),
  },
})

const lowerMessages = Effect.fn("OpenAIChat.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: text(request.system) }]
  const messages: OpenAIChatMessage[] = [...system]

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: TextPart[] = []
      for (const part of message.content) {
        if (part.type !== "text") return yield* invalid(`OpenAI Chat user messages only support text content for now`)
        content.push(part)
      }
      messages.push({ role: "user", content: text(content) })
      continue
    }

    if (message.role === "assistant") {
      const content: TextPart[] = []
      const toolCalls: OpenAIChatAssistantToolCall[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(part)
          continue
        }
        if (part.type === "tool-call") {
          toolCalls.push(lowerToolCall(part))
          continue
        }
        return yield* invalid(`OpenAI Chat assistant messages only support text and tool-call content for now`)
      }
      messages.push({
        role: "assistant",
        content: content.length === 0 ? null : text(content),
        tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
      })
      continue
    }

    for (const part of message.content) {
      if (part.type !== "tool-result")
        return yield* invalid(`OpenAI Chat tool messages only support tool-result content`)
      messages.push({ role: "tool", tool_call_id: part.id, content: resultText(part) })
    }
  }

  return messages
})

const prepare = Effect.fn("OpenAIChat.prepare")(function* (request: LLMRequest) {
  return {
    model: request.model.id,
    messages: yield* lowerMessages(request),
    tools: request.tools.length === 0 ? undefined : request.tools.map(lowerTool),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    max_tokens: request.generation.maxTokens,
    temperature: request.generation.temperature,
    top_p: request.generation.topP,
    stop: request.generation.stop,
  }
})

const toTransport = (target: OpenAIChatTarget, request: LLMRequest) =>
  Effect.succeed(
    new TransportRequest({
      url: `${baseUrl(request)}/chat/completions`,
      method: "POST",
      headers: {
        ...request.model.headers,
        "content-type": "application/json",
      },
      body: encodeTarget(target),
    }),
  )

const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  if (reason === "content_filter") return "content-filter"
  if (reason === "function_call" || reason === "tool_calls") return "tool-calls"
  if (reason === undefined || reason === null) return "unknown"
  return "unknown"
}

const mapUsage = (usage: OpenAIChatChunk["usage"]): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens,
    totalTokens: usage.total_tokens,
    native: usage,
  })
}

const chunkError = (message: string, raw?: string) => new ProviderChunkError({ adapter: "openai-chat", message, raw })

const parseJson = (input: string, message: string) => {
  try {
    return decodeJson(input)
  } catch {
    throw chunkError(message, input)
  }
}

const parseChunk = (data: string) => {
  try {
    return decodeChunk(data)
  } catch {
    throw chunkError("Invalid OpenAI Chat stream chunk", data)
  }
}

const pushToolDelta = (tools: Record<number, ToolAccumulator>, delta: OpenAIChatToolCallDelta) => {
  const current = tools[delta.index]
  const id = delta.id ?? current?.id
  const name = delta.function?.name ?? current?.name
  if (!id || !name) throw chunkError("OpenAI Chat tool call delta is missing id or name")

  return {
    id,
    name,
    input: `${current?.input ?? ""}${delta.function?.arguments ?? ""}`,
  }
}

const finishToolCalls = (state: ParserState) =>
  Object.values(state.tools).map((tool) => ({
    type: "tool-call" as const,
    id: tool.id,
    name: tool.name,
    input: parseJson(tool.input || "{}", `Invalid JSON input for OpenAI Chat tool call ${tool.name}`),
  }))

const processChunk = (state: ParserState, chunk: OpenAIChatChunk): readonly [ParserState, ReadonlyArray<LLMEvent>] => {
  const events: LLMEvent[] = []
  const usage = mapUsage(chunk.usage) ?? state.usage
  const choice = chunk.choices[0]
  const finishReason = choice?.finish_reason ? mapFinishReason(choice.finish_reason) : state.finishReason
  const delta = choice?.delta
  const toolCalls = delta?.tool_calls ?? []
  const tools = toolCalls.length === 0 ? state.tools : { ...state.tools }

  if (delta?.content) events.push({ type: "text-delta", text: delta.content })

  for (const tool of toolCalls) {
    const current = pushToolDelta(tools, tool)
    tools[tool.index] = current
    if (tool.function?.arguments) {
      events.push({ type: "tool-input-delta", id: current.id, name: current.name, text: tool.function.arguments })
    }
  }

  return [{ tools, usage, finishReason }, events]
}

const finishEvents = (state: ParserState): ReadonlyArray<LLMEvent> => {
  const hasToolCalls = Object.keys(state.tools).length > 0
  const reason = state.finishReason === "stop" && hasToolCalls ? "tool-calls" : state.finishReason
  return [
    ...(hasToolCalls ? finishToolCalls(state) : []),
    ...(reason ? ([{ type: "request-finish", reason, usage: state.usage }] satisfies ReadonlyArray<LLMEvent>) : []),
  ]
}

const events = (response: HttpClientResponse.HttpClientResponse) =>
  sseData(response, (error) => chunkError("Failed to read OpenAI Chat stream", String(error))).pipe(
    Stream.mapEffect((data) =>
      Effect.try({
        try: () => parseChunk(data),
        catch: (error) =>
          error instanceof ProviderChunkError ? error : chunkError("Invalid OpenAI Chat stream chunk", data),
      }),
    ),
    Stream.mapAccum((): ParserState => ({ tools: {} }), processChunk, { onHalt: finishEvents }),
  )

export const adapter = Adapter.define<OpenAIChatTarget, OpenAIChatTarget, LLMEvent>({
  id: "openai-chat",
  protocol: "openai-chat",
  builder: {
    empty: { model: "", messages: [], stream: true },
    concat: (left, right) => Effect.succeed({ ...left, ...right }),
    validate: (draft) => decodeTarget(draft).pipe(Effect.mapError((error) => invalid(error.message))),
  },
  redact: (target) => target,
  prepare,
  toTransport: (target, context) => toTransport(target, context.request),
  parse: events,
  raise: (event) => Stream.make(event),
})

export const model = (input: OpenAIChatModelInput) => {
  const { apiKey, headers, ...rest } = input
  return llmModel({
    ...rest,
    provider: "openai",
    protocol: "openai-chat",
    headers: apiKey ? { ...headers, authorization: `Bearer ${apiKey}` } : headers,
    capabilities: input.capabilities ?? capabilities({ tools: { calls: true, streamingInput: true } }),
  })
}

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI Chat streaming responses",
  apply: (target) => ({
    ...target,
    stream_options: { ...target.stream_options, include_usage: true },
  }),
})

export * as OpenAIChat from "./openai-chat"
