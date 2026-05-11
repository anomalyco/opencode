import { Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import {
  LLMEvent,
  Usage,
  type CacheHint,
  type FinishReason,
  type LLMRequest,
  type ProviderMetadata,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "anthropic-messages"
export const DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
export const PATH = "/messages"

// =============================================================================
// Request Body Schema
// =============================================================================
const AnthropicCacheControl = Schema.Struct({ type: Schema.tag("ephemeral") })

const AnthropicTextBlock = Schema.Struct({
  type: Schema.tag("text"),
  text: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicTextBlock = Schema.Schema.Type<typeof AnthropicTextBlock>

const AnthropicThinkingBlock = Schema.Struct({
  type: Schema.tag("thinking"),
  thinking: Schema.String,
  signature: Schema.optional(Schema.String),
  cache_control: Schema.optional(AnthropicCacheControl),
})

const AnthropicToolUseBlock = Schema.Struct({
  type: Schema.tag("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicToolUseBlock = Schema.Schema.Type<typeof AnthropicToolUseBlock>

const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.tag("server_tool_use"),
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
  type: Schema.tag("tool_result"),
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
]).pipe(Schema.toTaggedUnion("role"))
type AnthropicMessage = Schema.Schema.Type<typeof AnthropicMessage>

const AnthropicTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  cache_control: Schema.optional(AnthropicCacheControl),
})
type AnthropicTool = Schema.Schema.Type<typeof AnthropicTool>

const AnthropicToolChoice = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["auto", "any"]) }),
  Schema.Struct({ type: Schema.tag("tool"), name: Schema.String }),
])

const AnthropicThinking = Schema.Struct({
  type: Schema.tag("enabled"),
  budget_tokens: Schema.Number,
})

const AnthropicBodyFields = {
  model: Schema.String,
  system: optionalArray(AnthropicTextBlock),
  messages: Schema.Array(AnthropicMessage),
  tools: optionalArray(AnthropicTool),
  tool_choice: Schema.optional(AnthropicToolChoice),
  stream: Schema.Literal(true),
  max_tokens: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  top_k: Schema.optional(Schema.Number),
  stop_sequences: optionalArray(Schema.String),
  thinking: Schema.optional(AnthropicThinking),
}
const AnthropicMessagesBody = Schema.Struct(AnthropicBodyFields)
export type AnthropicMessagesBody = Schema.Schema.Type<typeof AnthropicMessagesBody>

const AnthropicUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: optionalNull(Schema.Number),
  cache_read_input_tokens: optionalNull(Schema.Number),
})
type AnthropicUsage = Schema.Schema.Type<typeof AnthropicUsage>

const AnthropicStreamBlock = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
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
  stop_reason: optionalNull(Schema.String),
  stop_sequence: optionalNull(Schema.String),
})

const AnthropicEvent = Schema.Struct({
  type: Schema.String,
  index: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.Struct({ usage: Schema.optional(AnthropicUsage) })),
  content_block: Schema.optional(AnthropicStreamBlock),
  delta: Schema.optional(AnthropicStreamDelta),
  usage: Schema.optional(AnthropicUsage),
  error: Schema.optional(Schema.Struct({ type: Schema.String, message: Schema.String })),
})
type AnthropicEvent = Schema.Schema.Type<typeof AnthropicEvent>

interface ParserState {
  readonly tools: ToolStream.State<number>
  readonly usage?: Usage
}

const invalid = ProviderShared.invalidRequest

// =============================================================================
// Request Lowering
// =============================================================================
const cacheControl = (cache: CacheHint | undefined) =>
  cache?.type === "ephemeral" ? { type: "ephemeral" as const } : undefined

const anthropicMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ anthropic: metadata })

const signatureFromMetadata = (metadata: ProviderMetadata | undefined): string | undefined => {
  const anthropic = metadata?.anthropic
  if (!ProviderShared.isRecord(anthropic)) return undefined
  return typeof anthropic.signature === "string" ? anthropic.signature : undefined
}

const lowerTool = (tool: ToolDefinition): AnthropicTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
})

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("Anthropic Messages", toolChoice, {
    auto: () => ({ type: "auto" as const }),
    none: () => undefined,
    required: () => ({ type: "any" as const }),
    tool: (name) => ({ type: "tool" as const, name }),
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
  if (!wireType)
    return yield* invalid(`Anthropic Messages does not know how to round-trip server tool result for ${part.name}`)
  return { type: wireType, tool_use_id: part.id, content: part.result.value } satisfies AnthropicServerToolResultBlock
})

const lowerMessages = Effect.fn("AnthropicMessages.lowerMessages")(function* (request: LLMRequest) {
  const messages: AnthropicMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: AnthropicTextBlock[] = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text"]))
          return yield* ProviderShared.unsupportedContent("Anthropic Messages", "user", ["text"])
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
          content.push({
            type: "thinking",
            thinking: part.text,
            signature: part.encrypted ?? signatureFromMetadata(part.providerMetadata),
          })
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
        return yield* invalid(
          `Anthropic Messages assistant messages only support text, reasoning, and tool-call content for now`,
        )
      }
      messages.push({ role: "assistant", content })
      continue
    }

    const content: AnthropicToolResultBlock[] = []
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent("Anthropic Messages", "tool", ["tool-result"])
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

const anthropicOptions = (request: LLMRequest) => request.providerOptions?.anthropic

const lowerThinking = Effect.fn("AnthropicMessages.lowerThinking")(function* (request: LLMRequest) {
  const thinking = anthropicOptions(request)?.thinking
  if (!ProviderShared.isRecord(thinking) || thinking.type !== "enabled") return undefined
  const budget =
    typeof thinking.budgetTokens === "number"
      ? thinking.budgetTokens
      : typeof thinking.budget_tokens === "number"
        ? thinking.budget_tokens
        : undefined
  if (budget === undefined) return yield* invalid("Anthropic thinking provider option requires budgetTokens")
  return { type: "enabled" as const, budget_tokens: budget }
})

const fromRequest = Effect.fn("AnthropicMessages.fromRequest")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  const generation = request.generation
  return {
    model: request.model.id,
    system:
      request.system.length === 0
        ? undefined
        : request.system.map((part) => ({
            type: "text" as const,
            text: part.text,
            cache_control: cacheControl(part.cache),
          })),
    messages: yield* lowerMessages(request),
    tools: request.tools.length === 0 || request.toolChoice?.type === "none" ? undefined : request.tools.map(lowerTool),
    tool_choice: toolChoice,
    stream: true as const,
    max_tokens: generation?.maxTokens ?? request.model.limits.output ?? 4096,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    top_k: generation?.topK,
    stop_sequences: generation?.stop,
    thinking: yield* lowerThinking(request),
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
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
    totalTokens: ProviderShared.totalTokens(usage.input_tokens, usage.output_tokens, undefined),
    native: usage,
  })
}

// Anthropic emits usage on `message_start` and again on `message_delta` — the
// final delta carries the authoritative totals. Right-biased merge: each
// field prefers `right` when defined, falls back to `left`. `totalTokens` is
// recomputed from the merged input/output to stay consistent.
const mergeUsage = (left: Usage | undefined, right: Usage | undefined) => {
  if (!left) return right
  if (!right) return left
  const inputTokens = right.inputTokens ?? left.inputTokens
  const outputTokens = right.outputTokens ?? left.outputTokens
  return new Usage({
    inputTokens,
    outputTokens,
    cacheReadInputTokens: right.cacheReadInputTokens ?? left.cacheReadInputTokens,
    cacheWriteInputTokens: right.cacheWriteInputTokens ?? left.cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(inputTokens, outputTokens, undefined),
    native: { ...left.native, ...right.native },
  })
}

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

const isServerToolResultType = (type: string): type is AnthropicServerToolResultType => type in SERVER_TOOL_RESULT_NAMES

const serverToolResultEvent = (block: NonNullable<AnthropicEvent["content_block"]>): LLMEvent | undefined => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined
  const errorPayload =
    typeof block.content === "object" && block.content !== null && "type" in block.content
      ? String((block.content as Record<string, unknown>).type)
      : ""
  const isError = errorPayload.endsWith("_tool_result_error")
  return LLMEvent.toolResult({
    id: block.tool_use_id ?? "",
    name: SERVER_TOOL_RESULT_NAMES[block.type],
    result: isError ? { type: "error", value: block.content } : { type: "json", value: block.content },
    providerExecuted: true,
    providerMetadata: anthropicMetadata({ blockType: block.type }),
  })
}

type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>]

const NO_EVENTS: StepResult["1"] = []

const onMessageStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const usage = mapUsage(event.message?.usage)
  return [usage ? { ...state, usage: mergeUsage(state.usage, usage) } : state, NO_EVENTS]
}

const onContentBlockStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const block = event.content_block
  if (!block) return [state, NO_EVENTS]

  if ((block.type === "tool_use" || block.type === "server_tool_use") && event.index !== undefined) {
    return [
      {
        ...state,
        tools: ToolStream.start(state.tools, event.index, {
          id: block.id ?? String(event.index),
          name: block.name ?? "",
          providerExecuted: block.type === "server_tool_use",
        }),
      },
      NO_EVENTS,
    ]
  }

  if (block.type === "text" && block.text) {
    return [state, [LLMEvent.textDelta({ id: `text-${event.index ?? 0}`, text: block.text })]]
  }

  if (block.type === "thinking" && block.thinking) {
    return [
      state,
      [
        LLMEvent.reasoningDelta({
          id: `reasoning-${event.index ?? 0}`,
          text: block.thinking,
        }),
      ],
    ]
  }

  const result = serverToolResultEvent(block)
  return [state, result ? [result] : NO_EVENTS]
}

const onContentBlockDelta = Effect.fn("AnthropicMessages.onContentBlockDelta")(function* (
  state: ParserState,
  event: AnthropicEvent,
) {
  const delta = event.delta

  if (delta?.type === "text_delta" && delta.text) {
    return [state, [LLMEvent.textDelta({ id: `text-${event.index ?? 0}`, text: delta.text })]] satisfies StepResult
  }

  if (delta?.type === "thinking_delta" && delta.thinking) {
    return [
      state,
      [LLMEvent.reasoningDelta({ id: `reasoning-${event.index ?? 0}`, text: delta.thinking })],
    ] satisfies StepResult
  }

  if (delta?.type === "signature_delta" && delta.signature) {
    return [
      state,
      [
        LLMEvent.reasoningEnd({
          id: `reasoning-${event.index ?? 0}`,
          providerMetadata: anthropicMetadata({ signature: delta.signature }),
        }),
      ],
    ] satisfies StepResult
  }

  if (delta?.type === "input_json_delta" && event.index !== undefined) {
    if (!delta.partial_json) return [state, NO_EVENTS] satisfies StepResult
    const result = ToolStream.appendExisting(
      ADAPTER,
      state.tools,
      event.index,
      delta.partial_json,
      "Anthropic Messages tool argument delta is missing its tool call",
    )
    if (ToolStream.isError(result)) return yield* result
    return [{ ...state, tools: result.tools }, result.event ? [result.event] : NO_EVENTS] satisfies StepResult
  }

  return [state, NO_EVENTS] satisfies StepResult
})

const onContentBlockStop = Effect.fn("AnthropicMessages.onContentBlockStop")(function* (
  state: ParserState,
  event: AnthropicEvent,
) {
  if (event.index === undefined) return [state, NO_EVENTS] satisfies StepResult
  const result = yield* ToolStream.finish(ADAPTER, state.tools, event.index)
  return [{ ...state, tools: result.tools }, result.event ? [result.event] : NO_EVENTS] satisfies StepResult
})

const onMessageDelta = (state: ParserState, event: AnthropicEvent): StepResult => {
  const usage = mergeUsage(state.usage, mapUsage(event.usage))
  return [
    { ...state, usage },
    [
      LLMEvent.requestFinish({
        reason: mapFinishReason(event.delta?.stop_reason),
        usage,
        providerMetadata: event.delta?.stop_sequence
          ? anthropicMetadata({ stopSequence: event.delta.stop_sequence })
          : undefined,
      }),
    ],
  ]
}

const onError = (state: ParserState, event: AnthropicEvent): StepResult => [
  state,
  [LLMEvent.providerError({ message: event.error?.message ?? "Anthropic Messages stream error" })],
]

const step = (state: ParserState, event: AnthropicEvent) => {
  if (event.type === "message_start") return Effect.succeed(onMessageStart(state, event))
  if (event.type === "content_block_start") return Effect.succeed(onContentBlockStart(state, event))
  if (event.type === "content_block_delta") return onContentBlockDelta(state, event)
  if (event.type === "content_block_stop") return onContentBlockStop(state, event)
  if (event.type === "message_delta") return Effect.succeed(onMessageDelta(state, event))
  if (event.type === "error") return Effect.succeed(onError(state, event))
  return Effect.succeed<StepResult>([state, NO_EVENTS])
}

// =============================================================================
// Protocol And Anthropic Route
// =============================================================================
/**
 * The Anthropic Messages protocol — request body construction, body schema,
 * and the streaming-event state machine. Used by native Anthropic Cloud and
 * (once registered) Vertex Anthropic / Bedrock-hosted Anthropic passthrough.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: AnthropicMessagesBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(AnthropicEvent),
    initial: () => ({ tools: ToolStream.empty<number>() }),
    step,
  },
})

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path(PATH),
  auth: Auth.apiKeyHeader("x-api-key"),
  framing: Framing.sse,
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = Route.model(route, {
  provider: "anthropic",
  baseURL: DEFAULT_BASE_URL,
})

export * as AnthropicMessages from "./anthropic-messages"
