import { Effect, Schema } from "effect"
import { Adapter, type AdapterModelInput } from "../adapter/client"
import { Endpoint } from "../adapter/endpoint"
import { capabilities } from "../llm"
import { Protocol } from "../adapter/protocol"
import {
  Usage,
  type CacheHint,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { BedrockEventStream } from "./bedrock-event-stream"
import { JsonObject, optionalArray, ProviderShared } from "./shared"
import { BedrockAuth, type Credentials as BedrockCredentials } from "./utils/bedrock-auth"
import { BedrockCache } from "./utils/bedrock-cache"
import { BedrockMedia } from "./utils/bedrock-media"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "bedrock-converse"

export type { Credentials as BedrockCredentials } from "./utils/bedrock-auth"

// =============================================================================
// Public Model Input
// =============================================================================
export type BedrockConverseModelInput = AdapterModelInput & {
  /**
   * Bearer API key (Bedrock's newer API key auth). Sets the `Authorization`
   * header and bypasses SigV4 signing. Mutually exclusive with `credentials`.
   */
  readonly apiKey?: string
  /**
   * AWS credentials for SigV4 signing. The adapter signs each request at
   * `toHttp` time using `aws4fetch`. Mutually exclusive with `apiKey`.
   */
  readonly credentials?: BedrockCredentials
  readonly headers?: Record<string, string>
}

// =============================================================================
// Request Payload Schema
// =============================================================================
const BedrockTextBlock = Schema.Struct({
  text: Schema.String,
})
type BedrockTextBlock = Schema.Schema.Type<typeof BedrockTextBlock>

const BedrockToolUseBlock = Schema.Struct({
  toolUse: Schema.Struct({
    toolUseId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
})
type BedrockToolUseBlock = Schema.Schema.Type<typeof BedrockToolUseBlock>

const BedrockToolResultContentItem = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ json: Schema.Unknown }),
])

const BedrockToolResultBlock = Schema.Struct({
  toolResult: Schema.Struct({
    toolUseId: Schema.String,
    content: Schema.Array(BedrockToolResultContentItem),
    status: Schema.optional(Schema.Literals(["success", "error"])),
  }),
})
type BedrockToolResultBlock = Schema.Schema.Type<typeof BedrockToolResultBlock>

const BedrockReasoningBlock = Schema.Struct({
  reasoningContent: Schema.Struct({
    reasoningText: Schema.optional(
      Schema.Struct({
        text: Schema.String,
        signature: Schema.optional(Schema.String),
      }),
    ),
  }),
})

const BedrockUserBlock = Schema.Union([
  BedrockTextBlock,
  BedrockMedia.ImageBlock,
  BedrockMedia.DocumentBlock,
  BedrockToolResultBlock,
  BedrockCache.CachePointBlock,
])
type BedrockUserBlock = Schema.Schema.Type<typeof BedrockUserBlock>

const BedrockAssistantBlock = Schema.Union([
  BedrockTextBlock,
  BedrockReasoningBlock,
  BedrockToolUseBlock,
  BedrockCache.CachePointBlock,
])
type BedrockAssistantBlock = Schema.Schema.Type<typeof BedrockAssistantBlock>

const BedrockMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Array(BedrockUserBlock) }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Array(BedrockAssistantBlock) }),
])
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>

const BedrockSystemBlock = Schema.Union([BedrockTextBlock, BedrockCache.CachePointBlock])
type BedrockSystemBlock = Schema.Schema.Type<typeof BedrockSystemBlock>

const BedrockTool = Schema.Struct({
  toolSpec: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.Struct({
      json: JsonObject,
    }),
  }),
})
type BedrockTool = Schema.Schema.Type<typeof BedrockTool>

const BedrockToolChoice = Schema.Union([
  Schema.Struct({ auto: Schema.Struct({}) }),
  Schema.Struct({ any: Schema.Struct({}) }),
  Schema.Struct({ tool: Schema.Struct({ name: Schema.String }) }),
])

const BedrockPayloadFields = {
  modelId: Schema.String,
  messages: Schema.Array(BedrockMessage),
  system: optionalArray(BedrockSystemBlock),
  inferenceConfig: Schema.optional(
    Schema.Struct({
      maxTokens: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
      topP: Schema.optional(Schema.Number),
      stopSequences: optionalArray(Schema.String),
    }),
  ),
  toolConfig: Schema.optional(
    Schema.Struct({
      tools: Schema.Array(BedrockTool),
      toolChoice: Schema.optional(BedrockToolChoice),
    }),
  ),
  additionalModelRequestFields: Schema.optional(JsonObject),
}
const BedrockConversePayload = Schema.Struct(BedrockPayloadFields)
export type BedrockConversePayload = Schema.Schema.Type<typeof BedrockConversePayload>

const BedrockUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
})
type BedrockUsageSchema = Schema.Schema.Type<typeof BedrockUsageSchema>

// Streaming chunk shape — the AWS event stream wraps each JSON payload by its
// `:event-type` header (e.g. `messageStart`, `contentBlockDelta`). We
// reconstruct that wrapping in `decodeFrames` below so the chunk schema can
// stay a plain discriminated record.
const BedrockChunk = Schema.Struct({
  messageStart: Schema.optional(Schema.Struct({ role: Schema.String })),
  contentBlockStart: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      start: Schema.optional(
        Schema.Struct({
          toolUse: Schema.optional(
            Schema.Struct({ toolUseId: Schema.String, name: Schema.String }),
          ),
        }),
      ),
    }),
  ),
  contentBlockDelta: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      delta: Schema.optional(
        Schema.Struct({
          text: Schema.optional(Schema.String),
          toolUse: Schema.optional(Schema.Struct({ input: Schema.String })),
          reasoningContent: Schema.optional(
            Schema.Struct({
              text: Schema.optional(Schema.String),
              signature: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
  contentBlockStop: Schema.optional(Schema.Struct({ contentBlockIndex: Schema.Number })),
  messageStop: Schema.optional(
    Schema.Struct({
      stopReason: Schema.String,
      additionalModelResponseFields: Schema.optional(Schema.Unknown),
    }),
  ),
  metadata: Schema.optional(
    Schema.Struct({
      usage: Schema.optional(BedrockUsageSchema),
      metrics: Schema.optional(Schema.Unknown),
    }),
  ),
  internalServerException: Schema.optional(Schema.Struct({ message: Schema.String })),
  modelStreamErrorException: Schema.optional(Schema.Struct({ message: Schema.String })),
  validationException: Schema.optional(Schema.Struct({ message: Schema.String })),
  throttlingException: Schema.optional(Schema.Struct({ message: Schema.String })),
  serviceUnavailableException: Schema.optional(Schema.Struct({ message: Schema.String })),
})
type BedrockChunk = Schema.Schema.Type<typeof BedrockChunk>

const invalid = ProviderShared.invalidRequest

// =============================================================================
// Request Lowering
// =============================================================================
const lowerTool = (tool: ToolDefinition): BedrockTool => ({
  toolSpec: {
    name: tool.name,
    description: tool.description,
    inputSchema: { json: tool.inputSchema },
  },
})

const textWithCache = (text: string, cache: CacheHint | undefined): Array<BedrockTextBlock | BedrockCache.CachePointBlock> => {
  const cachePoint = BedrockCache.block(cache)
  return cachePoint ? [{ text }, cachePoint] : [{ text }]
}

const lowerToolChoice = Effect.fn("BedrockConverse.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type === "none") return undefined
  if (toolChoice.type === "required") return { any: {} } as const
  if (toolChoice.type !== "tool") return { auto: {} } as const
  if (!toolChoice.name) return yield* invalid("Bedrock Converse tool choice requires a tool name")
  return { tool: { name: toolChoice.name } } as const
})

const lowerToolCall = (part: ToolCallPart): BedrockToolUseBlock => ({
  toolUse: {
    toolUseId: part.id,
    name: part.name,
    input: part.input,
  },
})

const lowerToolResult = (part: ToolResultPart): BedrockToolResultBlock => ({
  toolResult: {
    toolUseId: part.id,
    content:
      part.result.type === "text" || part.result.type === "error"
        ? [{ text: ProviderShared.toolResultText(part) }]
        : [{ json: part.result.value }],
    status: part.result.type === "error" ? "error" : "success",
  },
})

const lowerMessages = Effect.fn("BedrockConverse.lowerMessages")(function* (request: LLMRequest) {
  const messages: BedrockMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: BedrockUserBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(...textWithCache(part.text, part.cache))
          continue
        }
        if (part.type === "media") {
          content.push(yield* BedrockMedia.lower(part))
          continue
        }
        return yield* invalid("Bedrock Converse user messages only support text and media content for now")
      }
      messages.push({ role: "user", content })
      continue
    }

    if (message.role === "assistant") {
      const content: BedrockAssistantBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(...textWithCache(part.text, part.cache))
          continue
        }
        if (part.type === "reasoning") {
          content.push({
            reasoningContent: {
              reasoningText: { text: part.text, signature: part.encrypted },
            },
          })
          continue
        }
        if (part.type === "tool-call") {
          content.push(lowerToolCall(part))
          continue
        }
        return yield* invalid("Bedrock Converse assistant messages only support text, reasoning, and tool-call content for now")
      }
      messages.push({ role: "assistant", content })
      continue
    }

    const content: BedrockToolResultBlock[] = []
    for (const part of message.content) {
      if (part.type !== "tool-result")
        return yield* invalid("Bedrock Converse tool messages only support tool-result content")
      content.push(lowerToolResult(part))
    }
    messages.push({ role: "user", content })
  }

  return messages
})

// System prompts share the cache-point convention: emit the text block, then
// optionally a positional `cachePoint` marker.
const lowerSystem = (system: ReadonlyArray<LLMRequest["system"][number]>): BedrockSystemBlock[] =>
  system.flatMap((part) => textWithCache(part.text, part.cache))

const toPayload = Effect.fn("BedrockConverse.toPayload")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  const generation = request.generation
  return {
    modelId: request.model.id,
    messages: yield* lowerMessages(request),
    system: request.system.length === 0 ? undefined : lowerSystem(request.system),
    inferenceConfig:
      generation?.maxTokens === undefined &&
      generation?.temperature === undefined &&
      generation?.topP === undefined &&
      (generation?.stop === undefined || generation.stop.length === 0)
        ? undefined
        : {
            maxTokens: generation?.maxTokens,
            temperature: generation?.temperature,
            topP: generation?.topP,
            stopSequences: generation?.stop,
          },
    toolConfig:
      request.tools.length > 0 && request.toolChoice?.type !== "none"
        ? { tools: request.tools.map(lowerTool), toolChoice }
        : undefined,
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
const mapFinishReason = (reason: string): FinishReason => {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop"
  if (reason === "max_tokens") return "length"
  if (reason === "tool_use") return "tool-calls"
  if (reason === "content_filtered" || reason === "guardrail_intervened") return "content-filter"
  return "unknown"
}

const mapUsage = (usage: BedrockUsageSchema | undefined): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: ProviderShared.totalTokens(usage.inputTokens, usage.outputTokens, usage.totalTokens),
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    native: usage,
  })
}

interface ParserState {
  readonly tools: ToolStream.State<number>
  // Bedrock splits the finish into `messageStop` (carries `stopReason`) and
  // `metadata` (carries usage). Hold the terminal event in state so `onHalt`
  // can emit exactly one finish after both chunks have had a chance to arrive.
  readonly pendingFinish: { readonly reason: FinishReason; readonly usage?: Usage } | undefined
}

const processChunk = (state: ParserState, chunk: BedrockChunk) =>
  Effect.gen(function* () {
    if (chunk.contentBlockStart?.start?.toolUse) {
      const index = chunk.contentBlockStart.contentBlockIndex
      return [
        {
          ...state,
          tools: ToolStream.start(state.tools, index, {
            id: chunk.contentBlockStart.start.toolUse.toolUseId,
            name: chunk.contentBlockStart.start.toolUse.name,
          }),
        },
        [],
      ] as const
    }

    if (chunk.contentBlockDelta?.delta?.text) {
      return [state, [{ type: "text-delta" as const, text: chunk.contentBlockDelta.delta.text }]] as const
    }

    if (chunk.contentBlockDelta?.delta?.reasoningContent?.text) {
      return [
        state,
        [{ type: "reasoning-delta" as const, text: chunk.contentBlockDelta.delta.reasoningContent.text }],
      ] as const
    }

    if (chunk.contentBlockDelta?.delta?.toolUse) {
      const index = chunk.contentBlockDelta.contentBlockIndex
      const result = ToolStream.appendExisting(
        ADAPTER,
        state.tools,
        index,
        chunk.contentBlockDelta.delta.toolUse.input,
        "Bedrock Converse tool delta is missing its tool call",
      )
      if (ToolStream.isError(result)) return yield* result
      return [
        { ...state, tools: result.tools },
        result.event ? [result.event] : [],
      ] as const
    }

    if (chunk.contentBlockStop) {
      const result = yield* ToolStream.finish(ADAPTER, state.tools, chunk.contentBlockStop.contentBlockIndex)
      return [{ ...state, tools: result.tools }, result.event ? [result.event] : []] as const
    }

    if (chunk.messageStop) {
      return [
        {
          ...state,
          pendingFinish: { reason: mapFinishReason(chunk.messageStop.stopReason), usage: state.pendingFinish?.usage },
        },
        [],
      ] as const
    }

    if (chunk.metadata) {
      const usage = mapUsage(chunk.metadata.usage)
      return [
        { ...state, pendingFinish: { reason: state.pendingFinish?.reason ?? "stop", usage } },
        [],
      ] as const
    }

    if (chunk.internalServerException || chunk.modelStreamErrorException || chunk.serviceUnavailableException) {
      const message =
        chunk.internalServerException?.message ??
        chunk.modelStreamErrorException?.message ??
        chunk.serviceUnavailableException?.message ??
        "Bedrock Converse stream error"
      return [state, [{ type: "provider-error" as const, message, retryable: true }]] as const
    }

    if (chunk.validationException || chunk.throttlingException) {
      const message =
        chunk.validationException?.message ?? chunk.throttlingException?.message ?? "Bedrock Converse error"
      return [
        state,
        [{ type: "provider-error" as const, message, retryable: chunk.throttlingException !== undefined }],
      ] as const
    }

    return [state, []] as const
  })

const framing = BedrockEventStream.framing(ADAPTER)

const onHalt = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.pendingFinish
    ? [{ type: "request-finish", reason: state.pendingFinish.reason, usage: state.pendingFinish.usage }]
    : []

// =============================================================================
// Protocol And Bedrock Adapter
// =============================================================================
/**
 * The Bedrock Converse protocol — request lowering, payload schema, and the
 * streaming-chunk state machine.
 */
export const protocol = Protocol.define({
  id: ADAPTER,
  payload: BedrockConversePayload,
  toPayload,
  chunk: BedrockChunk,
  initial: () => ({ tools: ToolStream.empty<number>(), pendingFinish: undefined }),
  process: processChunk,
  onHalt,
})

export const adapter = Adapter.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.baseURL<BedrockConversePayload>({
    // Bedrock's URL embeds the region in the host and the validated modelId
    // in the path. We reach into the validated payload so the URL
    // matches the body that gets signed.
    default: ({ request }) => `https://bedrock-runtime.${BedrockAuth.region(request)}.amazonaws.com`,
    path: ({ payload }) => `/model/${encodeURIComponent(payload.modelId)}/converse-stream`,
  }),
  auth: BedrockAuth.auth,
  framing,
})

// =============================================================================
// Model Helper
// =============================================================================
export const defaultCapabilities = capabilities({
  output: { reasoning: true },
  tools: { calls: true, streamingInput: true },
  cache: { prompt: true, contentBlocks: true },
})

export const nativeCredentials = BedrockAuth.nativeCredentials

const bedrockModel = Adapter.model<BedrockConverseModelInput>(
  adapter,
  {
    provider: "bedrock",
    capabilities: defaultCapabilities,
  },
  {
    mapInput: (input) => {
      const { credentials, ...rest } = input
      return {
        ...rest,
        native: nativeCredentials(input.native, credentials),
      }
    },
  },
)

export const model = bedrockModel

export * as BedrockConverse from "./bedrock-converse"
