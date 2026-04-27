import { Effect, Schema, Stream } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  Usage,
  type CacheHint,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "anthropic-messages"

export type AnthropicMessagesModelInput = Omit<ModelInput, "provider" | "protocol" | "headers"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

const AnthropicCacheControl = Schema.Struct({ type: Schema.Literal("ephemeral") })

const AnthropicTextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicTextBlock = Schema.Schema.Type<typeof AnthropicTextBlock>

const AnthropicThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
  signature: Schema.optional(Schema.String),
  cache_control: Schema.optional(AnthropicCacheControl),
})

const AnthropicToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicToolUseBlock = Schema.Schema.Type<typeof AnthropicToolUseBlock>

const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.Literal("server_tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicServerToolUseBlock = Schema.Schema.Type<typeof AnthropicServerToolUseBlock>

// Server tool result blocks: web_search_tool_result, code_execution_tool_result,
// and web_fetch_tool_result. The provider executes the tool and inlines the
// structured result into the assistant turn — there is no client tool_result
// round-trip. We round-trip the structured `content` payload as opaque JSON so
// the next request can echo it back when continuing the conversation.
const AnthropicServerToolResultType = Schema.Literals([
  "web_search_tool_result",
  "code_execution_tool_result",
  "web_fetch_tool_result",
])
type AnthropicServerToolResultType = Schema.Schema.Type<typeof AnthropicServerToolResultType>

const AnthropicServerToolResultBlock = Schema.Struct({
  type: AnthropicServerToolResultType,
  tool_use_id: Schema.String,
  content: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicServerToolResultBlock = Schema.Schema.Type<typeof AnthropicServerToolResultBlock>

const AnthropicToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.String,
  is_error: Schema.optional(Schema.Boolean),
  cache_control: Schema.optional(AnthropicCacheControl),
})

const AnthropicUserBlock = Schema.Union([AnthropicTextBlock, AnthropicToolResultBlock])
const AnthropicAssistantBlock = Schema.Union([
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolUseBlock,
  AnthropicServerToolUseBlock,
  AnthropicServerToolResultBlock,
])
type AnthropicAssistantBlock = Schema.Schema.Type<typeof AnthropicAssistantBlock>
type AnthropicToolResultBlock = Schema.Schema.Type<typeof AnthropicToolResultBlock>

const AnthropicMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Array(AnthropicUserBlock) }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Array(AnthropicAssistantBlock) }),
])
type AnthropicMessage = Schema.Schema.Type<typeof AnthropicMessage>

const AnthropicTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: Schema.Record(Schema.String, Schema.Unknown),
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicTool = Schema.Schema.Type<typeof AnthropicTool>

const AnthropicToolChoice = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["auto", "any"]) }),
  Schema.Struct({ type: Schema.Literal("tool"), name: Schema.String }),
])

const AnthropicThinking = Schema.Struct({
  type: Schema.Literal("enabled"),
  budget_tokens: Schema.Number,
})

const AnthropicTargetFields = {
  model: Schema.String,
  system: Schema.optional(Schema.Array(AnthropicTextBlock)),
  messages: Schema.Array(AnthropicMessage),
  tools: Schema.optional(Schema.Array(AnthropicTool)),
  tool_choice: Schema.optional(AnthropicToolChoice),
  stream: Schema.Literal(true),
  max_tokens: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  stop_sequences: Schema.optional(Schema.Array(Schema.String)),
  thinking: Schema.optional(AnthropicThinking),
}
const AnthropicMessagesDraft = Schema.Struct(AnthropicTargetFields)
type AnthropicMessagesDraft = Schema.Schema.Type<typeof AnthropicMessagesDraft>
const AnthropicMessagesTarget = Schema.Struct(AnthropicTargetFields)
export type AnthropicMessagesTarget = Schema.Schema.Type<typeof AnthropicMessagesTarget>

const AnthropicUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  cache_read_input_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
})
type AnthropicUsage = Schema.Schema.Type<typeof AnthropicUsage>

const AnthropicStreamBlock = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
  // *_tool_result blocks arrive whole as content_block_start (no streaming
  // delta) with the structured payload in `content` and the originating
  // server_tool_use id in `tool_use_id`.
  tool_use_id: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Unknown),
})

const AnthropicStreamDelta = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  partial_json: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  stop_reason: Schema.optional(Schema.NullOr(Schema.String)),
  stop_sequence: Schema.optional(Schema.NullOr(Schema.String)),
})

const AnthropicChunk = Schema.Struct({
  type: Schema.String,
  index: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.Struct({ usage: Schema.optional(AnthropicUsage) })),
  content_block: Schema.optional(AnthropicStreamBlock),
  delta: Schema.optional(AnthropicStreamDelta),
  usage: Schema.optional(AnthropicUsage),
  error: Schema.optional(Schema.Struct({ type: Schema.String, message: Schema.String })),
})
type AnthropicChunk = Schema.Schema.Type<typeof AnthropicChunk>

interface ToolAccumulator {
  readonly id: string
  readonly name: string
  readonly input: string
  readonly providerExecuted: boolean
}

interface ParserState {
  readonly tools: Record<number, ToolAccumulator>
  readonly usage?: Usage
}

const AnthropicChunkJson = Schema.fromJsonString(AnthropicChunk)
const AnthropicTargetJson = Schema.fromJsonString(AnthropicMessagesTarget)
const decodeChunkSync = Schema.decodeUnknownSync(AnthropicChunkJson)

const decodeChunk = (data: string) =>
  Effect.try({
    try: () => decodeChunkSync(data),
    catch: () => ProviderShared.chunkError(ADAPTER, "Invalid Anthropic Messages stream chunk", data),
  })
const encodeTarget = Schema.encodeSync(AnthropicTargetJson)
const decodeTarget = Schema.decodeUnknownEffect(AnthropicMessagesDraft.pipe(Schema.decodeTo(AnthropicMessagesTarget)))

const invalid = ProviderShared.invalidRequest

const baseUrl = (request: LLMRequest) => ProviderShared.trimBaseUrl(request.model.baseURL ?? "https://api.anthropic.com/v1")

const cacheControl = (cache: CacheHint | undefined) => cache?.type === "ephemeral" ? { type: "ephemeral" as const } : undefined

const lowerTool = (tool: ToolDefinition): AnthropicTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
})

const lowerToolChoice = Effect.fn("AnthropicMessages.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type === "none") return undefined
  if (toolChoice.type === "required") return { type: "any" as const }
  if (toolChoice.type !== "tool") return { type: "auto" as const }
  if (!toolChoice.name) return yield* invalid("Anthropic Messages tool choice requires a tool name")
  return { type: "tool" as const, name: toolChoice.name }
})

const lowerToolCall = (part: ToolCallPart): AnthropicToolUseBlock => ({
  type: "tool_use",
  id: part.id,
  name: part.name,
  input: part.input,
})

const lowerServerToolCall = (part: ToolCallPart): AnthropicServerToolUseBlock => ({
  type: "server_tool_use",
  id: part.id,
  name: part.name,
  input: part.input,
})

// Server tool result blocks are typed by name. Anthropic ships three today;
// extend this list when new server tools land. The block content is the
// structured payload returned by the provider, which we round-trip as-is.
const serverToolResultType = (name: string): AnthropicServerToolResultType | undefined => {
  if (name === "web_search") return "web_search_tool_result"
  if (name === "code_execution") return "code_execution_tool_result"
  if (name === "web_fetch") return "web_fetch_tool_result"
  return undefined
}

const lowerServerToolResult = Effect.fn("AnthropicMessages.lowerServerToolResult")(function* (part: ToolResultPart) {
  const wireType = serverToolResultType(part.name)
  if (!wireType) return yield* invalid(`Anthropic Messages does not know how to round-trip server tool result for ${part.name}`)
  return { type: wireType, tool_use_id: part.id, content: part.result.value } satisfies AnthropicServerToolResultBlock
})

const lowerMessages = Effect.fn("AnthropicMessages.lowerMessages")(function* (request: LLMRequest) {
  const messages: AnthropicMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: AnthropicTextBlock[] = []
      for (const part of message.content) {
        if (part.type !== "text") return yield* invalid(`Anthropic Messages user messages only support text content for now`)
        content.push({ type: "text", text: part.text, cache_control: cacheControl(part.cache) })
      }
      messages.push({ role: "user", content })
      continue
    }

    if (message.role === "assistant") {
      const content: AnthropicAssistantBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text, cache_control: cacheControl(part.cache) })
          continue
        }
        if (part.type === "reasoning") {
          content.push({ type: "thinking", thinking: part.text, signature: part.encrypted })
          continue
        }
        if (part.type === "tool-call") {
          content.push(part.providerExecuted ? lowerServerToolCall(part) : lowerToolCall(part))
          continue
        }
        if (part.type === "tool-result" && part.providerExecuted) {
          content.push(yield* lowerServerToolResult(part))
          continue
        }
        return yield* invalid(`Anthropic Messages assistant messages only support text, reasoning, and tool-call content for now`)
      }
      messages.push({ role: "assistant", content })
      continue
    }

    const content: AnthropicToolResultBlock[] = []
    for (const part of message.content) {
      if (part.type !== "tool-result") return yield* invalid(`Anthropic Messages tool messages only support tool-result content`)
      content.push({
        type: "tool_result",
        tool_use_id: part.id,
        content: ProviderShared.toolResultText(part),
        is_error: part.result.type === "error" ? true : undefined,
      })
    }
    messages.push({ role: "user", content })
  }

  return messages
})

const thinkingBudget = (request: LLMRequest) => {
  if (!request.reasoning?.enabled) return undefined
  if (request.reasoning.effort === "minimal" || request.reasoning.effort === "low") return 1024
  if (request.reasoning.effort === "high") return 16000
  if (request.reasoning.effort === "xhigh") return 24576
  if (request.reasoning.effort === "max") return 32000
  return 8000
}

const prepare = Effect.fn("AnthropicMessages.prepare")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  const budget = thinkingBudget(request)
  return {
    model: request.model.id,
    system: request.system.length === 0
      ? undefined
      : request.system.map((part) => ({ type: "text" as const, text: part.text, cache_control: cacheControl(part.cache) })),
    messages: yield* lowerMessages(request),
    tools: request.tools.length === 0 || request.toolChoice?.type === "none" ? undefined : request.tools.map(lowerTool),
    tool_choice: toolChoice,
    stream: true as const,
    max_tokens: request.generation.maxTokens ?? request.model.limits.output ?? 4096,
    temperature: request.generation.temperature,
    top_p: request.generation.topP,
    stop_sequences: request.generation.stop,
    thinking: budget ? { type: "enabled" as const, budget_tokens: budget } : undefined,
  }
})

const toHttp = (target: AnthropicMessagesTarget, request: LLMRequest) =>
  Effect.succeed(
    ProviderShared.jsonPost({
      url: `${baseUrl(request)}/messages`,
      body: encodeTarget(target),
      headers: { "anthropic-version": "2023-06-01", ...request.model.headers },
    }),
  )

const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === "end_turn" || reason === "stop_sequence" || reason === "pause_turn") return "stop"
  if (reason === "max_tokens") return "length"
  if (reason === "tool_use") return "tool-calls"
  if (reason === "refusal") return "content-filter"
  return "unknown"
}

const mapUsage = (usage: AnthropicUsage | undefined): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteInputTokens: usage.cache_creation_input_tokens ?? undefined,
    totalTokens: usage.input_tokens !== undefined || usage.output_tokens !== undefined
      ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      : undefined,
    native: usage,
  })
}

const mergeUsage = (left: Usage | undefined, right: Usage | undefined) => {
  if (!left) return right
  if (!right) return left
  return new Usage({
    inputTokens: right.inputTokens ?? left.inputTokens,
    outputTokens: right.outputTokens ?? left.outputTokens,
    cacheReadInputTokens: right.cacheReadInputTokens ?? left.cacheReadInputTokens,
    cacheWriteInputTokens: right.cacheWriteInputTokens ?? left.cacheWriteInputTokens,
    totalTokens: (right.inputTokens ?? left.inputTokens) !== undefined || (right.outputTokens ?? left.outputTokens) !== undefined
      ? (right.inputTokens ?? left.inputTokens ?? 0) + (right.outputTokens ?? left.outputTokens ?? 0)
      : undefined,
    native: { ...left.native, ...right.native },
  })
}

const finishToolCall = (tool: ToolAccumulator | undefined) =>
  Effect.gen(function* () {
    if (!tool) return [] as ReadonlyArray<LLMEvent>
    const input = yield* ProviderShared.parseToolInput(ADAPTER, tool.name, tool.input)
    const event: LLMEvent = tool.providerExecuted
      ? { type: "tool-call", id: tool.id, name: tool.name, input, providerExecuted: true }
      : { type: "tool-call", id: tool.id, name: tool.name, input }
    return [event]
  })

// Server tool result blocks come whole in `content_block_start` (no streaming
// delta sequence). We convert the payload to a `tool-result` event with
// `providerExecuted: true`. The runtime appends it to the assistant message
// for round-trip; downstream consumers can inspect `result.value` for the
// structured payload.
const SERVER_TOOL_RESULT_NAMES: Record<AnthropicServerToolResultType, string> = {
  web_search_tool_result: "web_search",
  code_execution_tool_result: "code_execution",
  web_fetch_tool_result: "web_fetch",
}

const isServerToolResultType = (type: string): type is AnthropicServerToolResultType =>
  type in SERVER_TOOL_RESULT_NAMES

const serverToolResultEvent = (block: NonNullable<AnthropicChunk["content_block"]>): LLMEvent | undefined => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined
  const errorPayload =
    typeof block.content === "object" && block.content !== null && "type" in block.content
      ? String((block.content as Record<string, unknown>).type)
      : ""
  const isError = errorPayload.endsWith("_tool_result_error")
  return {
    type: "tool-result",
    id: block.tool_use_id ?? "",
    name: SERVER_TOOL_RESULT_NAMES[block.type],
    result: isError
      ? { type: "error", value: block.content }
      : { type: "json", value: block.content },
    providerExecuted: true,
  }
}

const processChunk = (state: ParserState, chunk: AnthropicChunk) =>
  Effect.gen(function* () {
    if (chunk.type === "message_start") {
      const usage = mapUsage(chunk.message?.usage)
      return [usage ? { ...state, usage: mergeUsage(state.usage, usage) } : state, []] as const
    }

    if (
      chunk.type === "content_block_start" &&
      chunk.index !== undefined &&
      (chunk.content_block?.type === "tool_use" || chunk.content_block?.type === "server_tool_use")
    ) {
      return [{
        ...state,
        tools: {
          ...state.tools,
          [chunk.index]: {
            id: chunk.content_block.id ?? String(chunk.index),
            name: chunk.content_block.name ?? "",
            input: "",
            providerExecuted: chunk.content_block.type === "server_tool_use",
          },
        },
      }, []] as const
    }

    if (chunk.type === "content_block_start" && chunk.content_block?.type === "text" && chunk.content_block.text) {
      return [state, [{ type: "text-delta", text: chunk.content_block.text }]] as const
    }

    if (chunk.type === "content_block_start" && chunk.content_block?.type === "thinking" && chunk.content_block.thinking) {
      return [state, [{ type: "reasoning-delta", text: chunk.content_block.thinking }]] as const
    }

    if (chunk.type === "content_block_start" && chunk.content_block) {
      const event = serverToolResultEvent(chunk.content_block)
      if (event) return [state, [event]] as const
    }

    if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && chunk.delta.text) {
      return [state, [{ type: "text-delta", text: chunk.delta.text }]] as const
    }

    if (chunk.type === "content_block_delta" && chunk.delta?.type === "thinking_delta" && chunk.delta.thinking) {
      return [state, [{ type: "reasoning-delta", text: chunk.delta.thinking }]] as const
    }

    if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta" && chunk.index !== undefined) {
      if (!chunk.delta.partial_json) return [state, []] as const
      const current = state.tools[chunk.index]
      if (!current) {
        return yield* ProviderShared.chunkError(ADAPTER, "Anthropic Messages tool argument delta is missing its tool call")
      }
      const next = { ...current, input: `${current.input}${chunk.delta.partial_json ?? ""}` }
      return [{ ...state, tools: { ...state.tools, [chunk.index]: next } }, [
        { type: "tool-input-delta" as const, id: next.id, name: next.name, text: chunk.delta.partial_json ?? "" },
      ]] as const
    }

    if (chunk.type === "content_block_stop" && chunk.index !== undefined) {
      const events = yield* finishToolCall(state.tools[chunk.index])
      const { [chunk.index]: _, ...tools } = state.tools
      return [{ ...state, tools }, events] as const
    }

    if (chunk.type === "message_delta") {
      const usage = mergeUsage(state.usage, mapUsage(chunk.usage))
      return [{ ...state, usage }, [{ type: "request-finish" as const, reason: mapFinishReason(chunk.delta?.stop_reason), usage }]] as const
    }

    if (chunk.type === "error") {
      return [state, [{ type: "provider-error" as const, message: chunk.error?.message ?? "Anthropic Messages stream error" }]] as const
    }

    return [state, []] as const
  })

const events = (response: HttpClientResponse.HttpClientResponse) =>
  ProviderShared.sse({
    adapter: ADAPTER,
    response,
    readError: "Failed to read Anthropic Messages stream",
    decodeChunk,
    initial: (): ParserState => ({ tools: {} }),
    process: processChunk,
  })

export const adapter = Adapter.define<AnthropicMessagesDraft, AnthropicMessagesTarget>({
  id: ADAPTER,
  protocol: "anthropic-messages",
  redact: (target) => target,
  prepare,
  validate: ProviderShared.validateWith(decodeTarget),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: events,
})

export const model = (input: AnthropicMessagesModelInput) => {
  const { apiKey, headers, ...rest } = input
  return llmModel({
    ...rest,
    provider: "anthropic",
    protocol: "anthropic-messages",
    headers: apiKey ? { ...headers, "x-api-key": apiKey } : headers,
    capabilities: input.capabilities ?? capabilities({
      output: { reasoning: true },
      tools: { calls: true, streamingInput: true },
      cache: { prompt: true, contentBlocks: true },
      reasoning: { efforts: ["low", "medium", "high", "xhigh", "max"], summaries: false, encryptedContent: true },
    }),
  })
}

export * as AnthropicMessages from "./anthropic-messages"
