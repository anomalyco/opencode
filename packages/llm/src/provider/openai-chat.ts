import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "openai-chat"

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

const OpenAIChatTargetFields = {
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
}
const OpenAIChatDraft = Schema.Struct(OpenAIChatTargetFields)
type OpenAIChatDraft = Schema.Schema.Type<typeof OpenAIChatDraft>
const OpenAIChatTarget = Schema.Struct(OpenAIChatTargetFields)
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

const { encodeTarget, decodeTarget, decodeChunk } = ProviderShared.codecs({
  adapter: ADAPTER,
  draft: OpenAIChatDraft,
  target: OpenAIChatTarget,
  chunk: OpenAIChatChunk,
  chunkErrorMessage: "Invalid OpenAI Chat stream chunk",
})

interface ParsedToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

interface ParserState {
  readonly tools: Record<number, ProviderShared.ToolAccumulator>
  readonly toolCalls: ReadonlyArray<ParsedToolCall>
  readonly usage?: Usage
  readonly finishReason?: FinishReason
}

const invalid = ProviderShared.invalidRequest

const baseUrl = (request: LLMRequest) => ProviderShared.trimBaseUrl(request.model.baseURL ?? "https://api.openai.com/v1")

const lowerTool = (tool: ToolDefinition): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
})

const lowerToolChoice = Effect.fn("OpenAIChat.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type !== "tool") return toolChoice.type
  if (!toolChoice.name) return yield* invalid("OpenAI Chat tool choice requires a tool name")
  return { type: "function" as const, function: { name: toolChoice.name } }
})

const lowerToolCall = (part: ToolCallPart): OpenAIChatAssistantToolCall => ({
  id: part.id,
  type: "function",
  function: {
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  },
})

const lowerMessages = Effect.fn("OpenAIChat.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  const messages: OpenAIChatMessage[] = [...system]

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: TextPart[] = []
      for (const part of message.content) {
        if (part.type !== "text") return yield* invalid(`OpenAI Chat user messages only support text content for now`)
        content.push(part)
      }
      messages.push({ role: "user", content: ProviderShared.joinText(content) })
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
        content: content.length === 0 ? null : ProviderShared.joinText(content),
        tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
      })
      continue
    }

    for (const part of message.content) {
      if (part.type !== "tool-result")
        return yield* invalid(`OpenAI Chat tool messages only support tool-result content`)
      messages.push({ role: "tool", tool_call_id: part.id, content: ProviderShared.toolResultText(part) })
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

const toHttp = (target: OpenAIChatTarget, request: LLMRequest) =>
  Effect.succeed(
    ProviderShared.jsonPost({
      url: ProviderShared.withQuery(`${baseUrl(request)}/chat/completions`, ProviderShared.queryParams(request)),
      body: encodeTarget(target),
      headers: request.model.headers,
    }),
  )

const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  if (reason === "content_filter") return "content-filter"
  if (reason === "function_call" || reason === "tool_calls") return "tool-calls"
  return "unknown"
}

const mapUsage = (usage: OpenAIChatChunk["usage"]): Usage | undefined => {
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

const pushToolDelta = (tools: Record<number, ProviderShared.ToolAccumulator>, delta: OpenAIChatToolCallDelta) =>
  Effect.gen(function* () {
    const current = tools[delta.index]
    const id = delta.id ?? current?.id
    const name = delta.function?.name ?? current?.name
    if (!id || !name) {
      return yield* ProviderShared.chunkError(ADAPTER, "OpenAI Chat tool call delta is missing id or name")
    }
    return {
      id,
      name,
      input: `${current?.input ?? ""}${delta.function?.arguments ?? ""}`,
    }
  })

const finalizeToolCalls = (tools: Record<number, ProviderShared.ToolAccumulator>) =>
  Effect.forEach(Object.values(tools), (tool) =>
    Effect.gen(function* () {
      const input = yield* ProviderShared.parseToolInput(ADAPTER, tool.name, tool.input)
      return { id: tool.id, name: tool.name, input } satisfies ParsedToolCall
    }),
  )

const processChunk = (state: ParserState, chunk: OpenAIChatChunk) =>
  Effect.gen(function* () {
    const events: LLMEvent[] = []
    const usage = mapUsage(chunk.usage) ?? state.usage
    const choice = chunk.choices[0]
    const finishReason = choice?.finish_reason ? mapFinishReason(choice.finish_reason) : state.finishReason
    const delta = choice?.delta
    const toolDeltas = delta?.tool_calls ?? []
    const tools = toolDeltas.length === 0 ? state.tools : { ...state.tools }

    if (delta?.content) events.push({ type: "text-delta", text: delta.content })

    for (const tool of toolDeltas) {
      const current = yield* pushToolDelta(tools, tool)
      tools[tool.index] = current
      if (tool.function?.arguments) {
        events.push({ type: "tool-input-delta", id: current.id, name: current.name, text: tool.function.arguments })
      }
    }

    // Finalize accumulated tool inputs eagerly when finish_reason arrives so
    // JSON parse failures fail the stream at the boundary rather than at halt.
    const toolCalls =
      finishReason !== undefined && state.finishReason === undefined && Object.keys(tools).length > 0
        ? yield* finalizeToolCalls(tools)
        : state.toolCalls

    return [{ tools, toolCalls, usage, finishReason }, events] as const
  })

const finishEvents = (state: ParserState): ReadonlyArray<LLMEvent> => {
  const hasToolCalls = state.toolCalls.length > 0
  const reason = state.finishReason === "stop" && hasToolCalls ? "tool-calls" : state.finishReason
  return [
    ...state.toolCalls.map((call) => ({ type: "tool-call" as const, ...call })),
    ...(reason ? ([{ type: "request-finish", reason, usage: state.usage }] satisfies ReadonlyArray<LLMEvent>) : []),
  ]
}

const events = (response: HttpClientResponse.HttpClientResponse) =>
  ProviderShared.sse({
    adapter: ADAPTER,
    response,
    readError: "Failed to read OpenAI Chat stream",
    decodeChunk,
    initial: (): ParserState => ({ tools: {}, toolCalls: [] }),
    process: processChunk,
    onHalt: finishEvents,
  })

export const adapter = Adapter.define<OpenAIChatDraft, OpenAIChatTarget>({
  id: ADAPTER,
  protocol: "openai-chat",
  redact: (target) => target,
  prepare,
  validate: ProviderShared.validateWith(decodeTarget),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: events,
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
