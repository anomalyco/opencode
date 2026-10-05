import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import { AIError, LLMEvent, type LanguageModelCompatibility, type LLMRequest } from "../schema/index.js"
import { classifyProviderFailure } from "../provider-error.js"
import { OpenAIChat } from "./openai-chat.js"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { cacheControl } from "./utils/cache.js"

// ---------------------------------------------------------------------------
// Public options and request body
// ---------------------------------------------------------------------------

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | (string & {})

const Parameters = Schema.Struct({
  enableWebSearch: Schema.optional(Schema.String),
  enableWebScraping: Schema.optional(Schema.Boolean),
  enableWebCitations: Schema.optional(Schema.Boolean),
  enableXSearch: Schema.optional(Schema.Boolean),
  stripThinkingResponse: Schema.optional(Schema.Boolean),
  disableThinking: Schema.optional(Schema.Boolean),
  includeVeniceSystemPrompt: Schema.optional(Schema.Boolean),
  characterSlug: Schema.optional(Schema.String),
  includeSearchResultsInStream: Schema.optional(Schema.Boolean),
  returnSearchResultsAsDocuments: Schema.optional(Schema.Boolean),
})

const Reasoning = Schema.Struct({
  effort: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  summary: Schema.optional(Schema.String),
})

export type OptionsInput = {
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoning?: {
    readonly effort?: ReasoningEffort
    readonly enabled?: boolean
    readonly summary?: "auto" | "concise" | "detailed" | (string & {})
  }
  readonly veniceParameters?: Omit<typeof Parameters.Type, "enableWebSearch"> & {
    readonly enableWebSearch?: "off" | "on" | "auto" | (string & {})
  }
  readonly promptCacheKey?: string
  readonly promptCacheRetention?: "default" | "extended" | "24h" | (string & {})
  readonly parallelToolCalls?: boolean
  readonly maxCompletionTokens?: number
  readonly maxTokens?: number
  readonly minP?: number
  readonly repetitionPenalty?: number
  readonly stopTokenIds?: readonly number[]
  readonly logprobs?: boolean
  readonly topLogprobs?: number
  readonly maxTemp?: number
  readonly minTemp?: number
  readonly responseFormat?: Readonly<Record<string, unknown>>
  readonly user?: string
}

const Options = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.String),
  reasoning: Schema.optional(Reasoning),
  veniceParameters: Schema.optional(Parameters),
  promptCacheKey: Schema.optional(Schema.String),
  promptCacheRetention: Schema.optional(Schema.String),
  parallelToolCalls: Schema.optional(Schema.Boolean),
  maxCompletionTokens: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  minP: Schema.optional(Schema.Number),
  repetitionPenalty: Schema.optional(Schema.Number),
  stopTokenIds: Schema.optional(Schema.Array(Schema.Number)),
  logprobs: Schema.optional(Schema.Boolean),
  topLogprobs: Schema.optional(Schema.Number),
  maxTemp: Schema.optional(Schema.Number),
  minTemp: Schema.optional(Schema.Number),
  responseFormat: Schema.optional(JsonObject),
  user: Schema.optional(Schema.String),
})

const ToolCall = Schema.Struct({
  ...OpenAIChat.OpenAIChatAssistantToolCall.fields,
  thought_signature: Schema.optional(Schema.String),
})
const Assistant = Schema.StructWithRest(
  Schema.Struct({
    ...OpenAIChat.OpenAIChatMessage.cases.assistant.schema.fields,
    tool_calls: optionalArray(ToolCall),
    thought_signature: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Messages = Schema.Array(
  Schema.Union([
    OpenAIChat.OpenAIChatMessage.cases.system,
    OpenAIChat.OpenAIChatMessage.cases.user,
    Assistant,
    OpenAIChat.OpenAIChatMessage.cases.tool,
  ]),
)
const Body = Schema.Struct({
  ...OpenAIChat.bodyFields,
  messages: Messages,
  reasoning: Schema.optional(Reasoning),
  venice_parameters: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
  prompt_cache_retention: Options.fields.promptCacheRetention,
  parallel_tool_calls: Options.fields.parallelToolCalls,
  min_p: Options.fields.minP,
  top_k: Schema.optional(Schema.Number),
  repetition_penalty: Options.fields.repetitionPenalty,
  stop_token_ids: Options.fields.stopTokenIds,
  logprobs: Options.fields.logprobs,
  top_logprobs: Options.fields.topLogprobs,
  max_temp: Options.fields.maxTemp,
  min_temp: Options.fields.minTemp,
  response_format: Options.fields.responseFormat,
  user: Options.fields.user,
})

// ---------------------------------------------------------------------------
// Streaming schemas and state
// ---------------------------------------------------------------------------

const ToolDelta = Schema.Struct({
  ...OpenAIChat.OpenAIChatToolCallDelta.fields,
  thought_signature: optionalNull(Schema.String),
})
const Delta = Schema.StructWithRest(
  Schema.Struct({
    ...OpenAIChat.OpenAIChatDelta.schema.fields,
    tool_calls: optionalNull(Schema.Array(ToolDelta)),
    thought_signature: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Choice = Schema.StructWithRest(
  Schema.Struct({ ...OpenAIChat.OpenAIChatChoice.schema.fields, delta: optionalNull(Delta) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Usage = Schema.StructWithRest(
  Schema.Struct({
    ...OpenAIChat.OpenAIChatUsage.schema.fields,
    prompt_tokens_details: optionalNull(
      Schema.StructWithRest(
        Schema.Struct({
          cached_tokens: optionalNull(Schema.Number),
          cache_write_tokens: optionalNull(Schema.Number),
          cache_creation_input_tokens: optionalNull(Schema.Number),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Event = Schema.StructWithRest(
  Schema.Struct({
    ...OpenAIChat.OpenAIChatEvent.schema.fields,
    choices: optionalNull(Schema.Array(Choice)),
    usage: optionalNull(Usage),
    error: optionalNull(Schema.Union([Schema.String, OpenAIChat.OpenAIChatEvent.schema.fields.error.schema])),
    issues: optionalArray(
      Schema.Struct({
        message: Schema.String,
        path: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

interface State {
  readonly shared: OpenAIChat.ParserState
  readonly pending: string
  readonly reasoning: string
  readonly encrypted: boolean
  readonly signature?: string
  readonly tools: Readonly<Record<string, string>>
}

const MARKER = "__ENCRYPTED_REASONING__"

// ---------------------------------------------------------------------------
// Request lowering
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("VeniceChat.fromRequest")(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  const body = yield* OpenAIChat.fromRequest(request, {
    cacheControl: cacheControl(),
    assistant: (source, message) => {
      if (message.role !== "assistant") return message
      const parts = source.content.filter(
        (part) => part.type === "text" || part.type === "reasoning" || part.type === "tool-call",
      )
      const calls = source.content.filter((part) => part.type === "tool-call")
      const signature = parts
        .map((part) => part.providerMetadata?.venice?.messageThoughtSignature)
        .find((value) => typeof value === "string")
      const raw = parts
        .map((part) => part.providerMetadata?.venice?.encryptedReasoningContent)
        .find((value) => typeof value === "string")
      return {
        ...message,
        ...(signature === undefined ? {} : { thought_signature: signature }),
        ...(raw === undefined ? {} : { reasoning_content: raw }),
        tool_calls: message.tool_calls?.map((call, index) => {
          const signature = calls[index]?.providerMetadata?.venice?.thoughtSignature
          return { ...call, ...(typeof signature === "string" ? { thought_signature: signature } : {}) }
        }),
      }
    },
  })
  return {
    ...body,
    max_completion_tokens: options.maxCompletionTokens ?? options.maxTokens ?? request.generation?.maxTokens,
    reasoning_effort: undefined,
    reasoning:
      options.reasoningEffort === undefined
        ? options.reasoning
        : { ...options.reasoning, effort: options.reasoningEffort },
    // Match the previous Venice SDK default, not the gateway's added prompt.
    venice_parameters: Object.fromEntries(
      Object.entries({
        ...options.veniceParameters,
        includeVeniceSystemPrompt: options.veniceParameters?.includeVeniceSystemPrompt ?? false,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]),
    ),
    prompt_cache_retention: options.promptCacheRetention,
    parallel_tool_calls: options.parallelToolCalls,
    min_p: options.minP,
    top_k: request.generation?.topK,
    repetition_penalty: options.repetitionPenalty,
    stop_token_ids: options.stopTokenIds,
    logprobs: options.logprobs,
    top_logprobs: options.topLogprobs,
    max_temp: options.maxTemp,
    min_temp: options.minTemp,
    response_format: options.responseFormat,
    user: options.user,
  }
})

// ---------------------------------------------------------------------------
// Venice normalization around the shared Chat state machine
// ---------------------------------------------------------------------------

const step = Effect.fn("VeniceChat.step")(function* (state: State, event: typeof Event.Type) {
  if (typeof event.error === "string")
    return yield* new AIError({
      reason: classifyProviderFailure({
        message: [
          event.error,
          ...(event.issues ?? []).map(
            (issue) => `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
          ),
        ].join("; "),
        rawBody: ProviderShared.encodeJson(event),
      }),
    })
  const delta = event.choices?.[0]?.delta
  const scalar = delta?.reasoning_content ?? ""
  const text = state.pending + scalar
  const marker = text.indexOf(MARKER)
  const pending =
    marker >= 0 || state.encrypted
      ? 0
      : (Array.from({ length: Math.min(text.length, MARKER.length - 1) }, (_, index) => index + 1)
          .filter((length) => text.endsWith(MARKER.slice(0, length)))
          .at(-1) ?? 0)
  const visible = state.encrypted ? "" : marker >= 0 ? text.slice(0, marker) : text.slice(0, text.length - pending)
  const result = yield* OpenAIChat.protocol.stream.step(state.shared, {
    ...event,
    error: event.error,
    usage: event.usage
      ? {
          ...event.usage,
          prompt_tokens_details: event.usage.prompt_tokens_details
            ? {
                ...event.usage.prompt_tokens_details,
                cache_write_tokens:
                  event.usage.prompt_tokens_details.cache_write_tokens ??
                  event.usage.prompt_tokens_details.cache_creation_input_tokens,
              }
            : event.usage.prompt_tokens_details,
        }
      : event.usage,
    choices: event.choices?.map((choice, index) =>
      index === 0 && choice.delta
        ? {
            ...choice,
            delta: {
              ...choice.delta,
              reasoning_content: visible || undefined,
              // Opaque-only scalar reasoning still needs a canonical part for replay.
              reasoning_details: choice.delta.reasoning_details ?? (marker >= 0 ? [] : undefined),
            },
          }
        : choice,
    ),
  })
  const tools = { ...state.tools }
  for (const call of delta?.tool_calls ?? []) {
    if (!call.thought_signature) continue
    const index = call.index ?? result[0].latestToolIndex
    const id =
      call.id ?? (index === undefined ? undefined : (result[0].tools[index]?.id ?? result[0].pendingTools[index]?.id))
    if (id) tools[id] = call.thought_signature
  }
  return [
    {
      shared: result[0],
      pending: pending ? text.slice(-pending) : "",
      reasoning: state.reasoning + scalar,
      encrypted: state.encrypted || marker >= 0,
      signature: delta?.thought_signature ?? state.signature,
      tools,
    },
    result[1],
  ] as const
})

const onHalt = Effect.fn("VeniceChat.onHalt")(function* (state: State) {
  const events = yield* OpenAIChat.finishEvents(state.shared)
  return events.flatMap((event): LLMEvent[] => {
    if (
      event.type !== "reasoning-end" &&
      event.type !== "text-end" &&
      event.type !== "tool-call" &&
      event.type !== "tool-input-end"
    )
      return [event]
    const signature = event.type === "tool-call" || event.type === "tool-input-end" ? state.tools[event.id] : undefined
    const providerMetadata = {
      ...event.providerMetadata,
      venice: {
        ...event.providerMetadata?.venice,
        ...(state.signature ? { messageThoughtSignature: state.signature } : {}),
        ...(signature ? { thoughtSignature: signature } : {}),
        ...(event.type === "reasoning-end" && state.encrypted ? { encryptedReasoningContent: state.reasoning } : {}),
      },
    }
    if (event.type === "reasoning-end" && state.pending)
      return [LLMEvent.reasoningDelta({ id: event.id, text: state.pending }), { ...event, providerMetadata }]
    return [{ ...event, providerMetadata }]
  })
})

export const compatibility = {
  maxTokensField: "max_completion_tokens",
  supportsStore: false,
  supportsPromptCacheKey: true,
} satisfies LanguageModelCompatibility

export const protocol = Protocol.make({
  id: "venice-chat",
  body: { schema: Body, from: fromRequest },
  stream: {
    event: Schema.Union([Schema.Literal("[DONE]"), Protocol.jsonEvent(Event)]),
    initial: (request): State => ({
      shared: OpenAIChat.protocol.stream.initial(request),
      pending: "",
      reasoning: "",
      encrypted: false,
      tools: {},
    }),
    step: (state: State, event) => (event === "[DONE]" ? Effect.succeed([state, []] as const) : step(state, event)),
    terminal: (event) => event === "[DONE]",
    onHalt,
  },
})

export * as VeniceChat from "./venice-chat.js"
