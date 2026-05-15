import { Effect, Schema } from "effect"
import { Route, type RouteModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Protocol } from "../route/protocol"
import {
  LLMEvent,
  Usage,
  type CacheHint,
  type FinishReason,
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
import { Lifecycle } from "./utils/lifecycle"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "bedrock-converse"

export type { Credentials as BedrockCredentials } from "./utils/bedrock-auth"

// =============================================================================
// Public Model Input
// =============================================================================
export type BedrockConverseModelInput = RouteModelInput & {
  /**
   * Bearer API key (Bedrock's newer API key auth). Sets the `Authorization`
   * header and bypasses SigV4 signing. Mutually exclusive with `credentials`.
   */
  readonly apiKey?: string
  /**
   * AWS credentials for SigV4 signing. The route signs each request at
   * `toHttp` time using `aws4fetch`. Mutually exclusive with `apiKey`.
   */
  readonly credentials?: BedrockCredentials
  readonly headers?: Record<string, string>
}

// =============================================================================
// Request Body Schema
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
]).pipe(Schema.toTaggedUnion("role"))
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>

const BedrockSystemBlock = Schema.Union([BedrockTextBlock, BedrockCache.CachePointBlock])
type BedrockSystemBlock = Schema.Schema.Type<typeof BedrockSystemBlock>

const BedrockToolSpec = Schema.Struct({
  toolSpec: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.Struct({
      json: JsonObject,
    }),
  }),
})
type BedrockToolSpec = Schema.Schema.Type<typeof BedrockToolSpec>

const BedrockTool = Schema.Union([BedrockToolSpec, BedrockCache.CachePointBlock])
type BedrockTool = Schema.Schema.Type<typeof BedrockTool>

const BedrockToolChoice = Schema.Union([
  Schema.Struct({ auto: Schema.Struct({}) }),
  Schema.Struct({ any: Schema.Struct({}) }),
  Schema.Struct({ tool: Schema.Struct({ name: Schema.String }) }),
])

const BedrockBodyFields = {
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
const BedrockConverseBody = Schema.Struct(BedrockBodyFields)
export type BedrockConverseBody = Schema.Schema.Type<typeof BedrockConverseBody>

const BedrockUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
})
type BedrockUsageSchema = Schema.Schema.Type<typeof BedrockUsageSchema>

// Streaming event shape — the AWS event stream wraps each JSON payload by its
// `:event-type` header (e.g. `messageStart`, `contentBlockDelta`). We
// reconstruct that wrapping in `decodeFrames` below so the event schema can
// stay a plain discriminated record.
const BedrockEvent = Schema.Struct({
  messageStart: Schema.optional(Schema.Struct({ role: Schema.String })),
  contentBlockStart: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      start: Schema.optional(
        Schema.Struct({
          toolUse: Schema.optional(Schema.Struct({ toolUseId: Schema.String, name: Schema.String })),
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
type BedrockEvent = Schema.Schema.Type<typeof BedrockEvent>

// =============================================================================
// Request Lowering
// =============================================================================
const lowerToolSpec = (tool: ToolDefinition): BedrockToolSpec => ({
  toolSpec: {
    name: tool.name,
    description: tool.description,
    inputSchema: { json: tool.inputSchema },
  },
})

const lowerTools = (breakpoints: BedrockCache.Breakpoints, tools: ReadonlyArray<ToolDefinition>): BedrockTool[] => {
  const result: BedrockTool[] = []
  for (const tool of tools) {
    result.push(lowerToolSpec(tool))
    const cachePoint = BedrockCache.block(breakpoints, tool.cache)
    if (cachePoint) result.push(cachePoint)
  }
  return result
}

const textWithCache = (
  breakpoints: BedrockCache.Breakpoints,
  text: string,
  cache: CacheHint | undefined,
): Array<BedrockTextBlock | BedrockCache.CachePointBlock> => {
  const cachePoint = BedrockCache.block(breakpoints, cache)
  return cachePoint ? [{ text }, cachePoint] : [{ text }]
}

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("Bedrock Converse", toolChoice, {
    auto: () => ({ auto: {} }) as const,
    none: () => undefined,
    required: () => ({ any: {} }) as const,
    tool: (name) => ({ tool: { name } }) as const,
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

const lowerMessages = Effect.fn("BedrockConverse.lowerMessages")(function* (
  request: LLMRequest,
  breakpoints: BedrockCache.Breakpoints,
) {
  const messages: BedrockMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: BedrockUserBlock[] = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "media"]))
          return yield* ProviderShared.unsupportedContent("Bedrock Converse", "user", ["text", "media"])
        if (part.type === "text") {
          content.push(...textWithCache(breakpoints, part.text, part.cache))
          continue
        }
        if (part.type === "media") {
          content.push(yield* BedrockMedia.lower(part))
          continue
        }
      }
      messages.push({ role: "user", content })
      continue
    }

    if (message.role === "assistant") {
      const content: BedrockAssistantBlock[] = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call"]))
          return yield* ProviderShared.unsupportedContent("Bedrock Converse", "assistant", [
            "text",
            "reasoning",
            "tool-call",
          ])
        if (part.type === "text") {
          content.push(...textWithCache(breakpoints, part.text, part.cache))
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
      }
      messages.push({ role: "assistant", content })
      continue
    }

    const content: BedrockUserBlock[] = []
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent("Bedrock Converse", "tool", ["tool-result"])
      content.push(lowerToolResult(part))
      const cachePoint = BedrockCache.block(breakpoints, part.cache)
      if (cachePoint) content.push(cachePoint)
    }
    messages.push({ role: "user", content })
  }

  return messages
})

// System prompts share the cache-point convention: emit the text block, then
// optionally a positional `cachePoint` marker.
const lowerSystem = (
  breakpoints: BedrockCache.Breakpoints,
  system: ReadonlyArray<LLMRequest["system"][number]>,
): BedrockSystemBlock[] => system.flatMap((part) => textWithCache(breakpoints, part.text, part.cache))

const fromRequest = Effect.fn("BedrockConverse.fromRequest")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  const generation = request.generation
  // Bedrock-Claude shares Anthropic's 4-breakpoint cap. Spend the budget in
  // tools → system → messages order to favour the highest-impact prefixes.
  const breakpoints = BedrockCache.breakpoints()
  const toolConfig =
    request.tools.length > 0 && request.toolChoice?.type !== "none"
      ? { tools: lowerTools(breakpoints, request.tools), toolChoice }
      : undefined
  const system = request.system.length === 0 ? undefined : lowerSystem(breakpoints, request.system)
  const messages = yield* lowerMessages(request, breakpoints)
  if (breakpoints.dropped > 0) {
    yield* Effect.logWarning(
      `Bedrock Converse: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${BedrockCache.BEDROCK_BREAKPOINT_CAP} per request.`,
    )
  }
  return {
    modelId: request.model.id,
    messages,
    system,
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
    toolConfig,
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

// AWS Bedrock Converse reports `inputTokens` (inclusive total) with
// `cacheReadInputTokens` and `cacheWriteInputTokens` as subsets. Pass
// the total through and derive the non-cached breakdown. Bedrock does
// not break reasoning out of `outputTokens` for any current model.
const mapUsage = (usage: BedrockUsageSchema | undefined): Usage | undefined => {
  if (!usage) return undefined
  const cacheTotal = (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0)
  const nonCached = ProviderShared.subtractTokens(usage.inputTokens, cacheTotal)
  return new Usage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(usage.inputTokens, usage.outputTokens, usage.totalTokens),
    providerMetadata: { bedrock: usage },
  })
}

interface ParserState {
  readonly tools: ToolStream.State<number>
  // Bedrock splits the finish into `messageStop` (carries `stopReason`) and
  // `metadata` (carries usage). Hold the terminal event in state so `onHalt`
  // can emit exactly one finish after both chunks have had a chance to arrive.
  readonly pendingFinish: { readonly reason: FinishReason; readonly usage?: Usage } | undefined
  readonly hasToolCalls: boolean
  readonly lifecycle: Lifecycle.State
}

const step = (state: ParserState, event: BedrockEvent) =>
  Effect.gen(function* () {
    if (event.contentBlockStart?.start?.toolUse) {
      const index = event.contentBlockStart.contentBlockIndex
      const events: LLMEvent[] = []
      const lifecycle = Lifecycle.stepStart(state.lifecycle, events)
      return [
        {
          ...state,
          lifecycle,
          tools: ToolStream.start(state.tools, index, {
            id: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
          }),
        },
        [
          ...events,
          LLMEvent.toolInputStart({
            id: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
          }),
        ],
      ] as const
    }

    if (event.contentBlockDelta?.delta?.text) {
      const events: LLMEvent[] = []
      return [
        {
          ...state,
          lifecycle: Lifecycle.textDelta(
            state.lifecycle,
            events,
            `text-${event.contentBlockDelta.contentBlockIndex}`,
            event.contentBlockDelta.delta.text,
          ),
        },
        events,
      ] as const
    }

    if (event.contentBlockDelta?.delta?.reasoningContent?.text) {
      const events: LLMEvent[] = []
      return [
        {
          ...state,
          lifecycle: Lifecycle.reasoningDelta(
            state.lifecycle,
            events,
            `reasoning-${event.contentBlockDelta.contentBlockIndex}`,
            event.contentBlockDelta.delta.reasoningContent.text,
          ),
        },
        events,
      ] as const
    }

    if (event.contentBlockDelta?.delta?.toolUse) {
      const index = event.contentBlockDelta.contentBlockIndex
      const result = ToolStream.appendExisting(
        ADAPTER,
        state.tools,
        index,
        event.contentBlockDelta.delta.toolUse.input,
        "Bedrock Converse tool delta is missing its tool call",
      )
      if (ToolStream.isError(result)) return yield* result
      const events: LLMEvent[] = []
      const lifecycle = result.events.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle
      events.push(...result.events)
      return [{ ...state, lifecycle, tools: result.tools }, events] as const
    }

    if (event.contentBlockStop) {
      const result = yield* ToolStream.finish(ADAPTER, state.tools, event.contentBlockStop.contentBlockIndex)
      const events: LLMEvent[] = []
      const resultEvents = result.events ?? []
      const lifecycle = resultEvents.length
        ? Lifecycle.stepStart(state.lifecycle, events)
        : Lifecycle.reasoningEnd(
            Lifecycle.textEnd(state.lifecycle, events, `text-${event.contentBlockStop.contentBlockIndex}`),
            events,
            `reasoning-${event.contentBlockStop.contentBlockIndex}`,
          )
      events.push(...resultEvents)
      return [
        {
          ...state,
          hasToolCalls: resultEvents.some(LLMEvent.is.toolCall) ? true : state.hasToolCalls,
          lifecycle,
          tools: result.tools,
        },
        events,
      ] as const
    }

    if (event.messageStop) {
      return [
        {
          ...state,
          pendingFinish: { reason: mapFinishReason(event.messageStop.stopReason), usage: state.pendingFinish?.usage },
        },
        [],
      ] as const
    }

    if (event.metadata) {
      const usage = mapUsage(event.metadata.usage)
      return [{ ...state, pendingFinish: { reason: state.pendingFinish?.reason ?? "stop", usage } }, []] as const
    }

    if (event.internalServerException || event.modelStreamErrorException || event.serviceUnavailableException) {
      const message =
        event.internalServerException?.message ??
        event.modelStreamErrorException?.message ??
        event.serviceUnavailableException?.message ??
        "Bedrock Converse stream error"
      return [state, [LLMEvent.providerError({ message, retryable: true })]] as const
    }

    if (event.validationException || event.throttlingException) {
      const message =
        event.validationException?.message ?? event.throttlingException?.message ?? "Bedrock Converse error"
      return [state, [LLMEvent.providerError({ message, retryable: event.throttlingException !== undefined })]] as const
    }

    return [state, []] as const
  })

const framing = BedrockEventStream.framing(ADAPTER)

const onHalt = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.pendingFinish
    ? (() => {
        const events: LLMEvent[] = []
        Lifecycle.finish(state.lifecycle, events, {
          reason:
            state.pendingFinish.reason === "stop" && state.hasToolCalls ? "tool-calls" : state.pendingFinish.reason,
          usage: state.pendingFinish.usage,
        })
        return events
      })()
    : []

// =============================================================================
// Protocol And Bedrock Route
// =============================================================================
/**
 * The Bedrock Converse protocol — request body construction, body schema, and
 * the streaming-event state machine.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: BedrockConverseBody,
    from: fromRequest,
  },
  stream: {
    event: BedrockEvent,
    initial: () => ({
      tools: ToolStream.empty<number>(),
      pendingFinish: undefined,
      hasToolCalls: false,
      lifecycle: Lifecycle.initial(),
    }),
    step,
    onHalt,
  },
})

export const route = Route.make({
  id: ADAPTER,
  protocol,
  // Bedrock's URL embeds the region in the host (set on `model.baseURL` by
  // the provider helper from credentials) and the validated modelId in the
  // path. We read the validated body so the URL matches the body that gets
  // signed.
  endpoint: Endpoint.path<BedrockConverseBody>(
    ({ body }) => `/model/${encodeURIComponent(body.modelId)}/converse-stream`,
  ),
  auth: BedrockAuth.auth,
  framing,
})

export const nativeCredentials = BedrockAuth.nativeCredentials

const bedrockModel = Route.model(
  route,
  {
    provider: "bedrock",
  },
  {
    mapInput: (input: BedrockConverseModelInput) => {
      const { credentials, ...rest } = input
      const region = credentials?.region ?? "us-east-1"
      return {
        ...rest,
        baseURL: rest.baseURL ?? `https://bedrock-runtime.${region}.amazonaws.com`,
        native: nativeCredentials(input.native, credentials),
      }
    },
  },
)

export const model = bedrockModel

export * as BedrockConverse from "./bedrock-converse"
