import { Effect, Schema } from "effect"
import { Auth } from "../route/auth.js"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import { HttpTransport } from "../route/transport/index.js"
import {
  AIError,
  InvalidProviderOutputError,
  LLMEvent,
  Usage,
  type FinishReasonDetails,
  type LLMRequest,
  type MediaPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema/index.js"
import { classifyProviderFailure } from "../provider-error.js"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { ToolStream } from "./utils/tool-stream.js"

const ADAPTER = "mistral-chat"
const DONE = "[DONE]" as const
const TOOL_ID = /^[A-Za-z0-9]{9}$/
export const DEFAULT_BASE_URL = "https://api.mistral.ai/v1"
export const PATH = "/chat/completions"

const MistralTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
})

const MistralThinkingUnit = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type MistralThinkingUnit = Schema.Schema.Type<typeof MistralThinkingUnit>

const MistralThinkingContent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.Literal("thinking"),
    thinking: Schema.Array(MistralThinkingUnit),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type MistralThinkingContent = Schema.Schema.Type<typeof MistralThinkingContent>
const isMistralThinkingContent = Schema.is(MistralThinkingContent)

const MistralUserContent = Schema.Union([
  MistralTextContent,
  Schema.Struct({ type: Schema.Literal("image_url"), image_url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("document_url"), document_url: Schema.String }),
])
type MistralUserContent = Schema.Schema.Type<typeof MistralUserContent>

const MistralAssistantToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("function"),
  function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
})
type MistralAssistantToolCall = Schema.Schema.Type<typeof MistralAssistantToolCall>

const MistralMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Union([Schema.String, Schema.Array(MistralUserContent)]),
  }),
  Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Union([Schema.String, Schema.Array(Schema.Union([MistralTextContent, MistralThinkingContent]))]),
    tool_calls: optionalArray(MistralAssistantToolCall),
    prefix: Schema.optional(Schema.Literal(true)),
  }),
  Schema.Struct({
    role: Schema.Literal("tool"),
    tool_call_id: Schema.String,
    name: Schema.String,
    content: Schema.Union([Schema.String, Schema.Array(MistralUserContent)]),
  }),
]).pipe(Schema.toTaggedUnion("role"))
type MistralMessage = Schema.Schema.Type<typeof MistralMessage>

const MistralTool = Schema.Struct({
  type: Schema.Literal("function"),
  function: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    parameters: JsonObject,
    strict: Schema.Literal(false),
  }),
})
type MistralTool = Schema.Schema.Type<typeof MistralTool>

const MistralOptions = Schema.Struct({
  safePrompt: Schema.optional(Schema.Boolean),
  documentImageLimit: Schema.optional(Schema.Number),
  documentPageLimit: Schema.optional(Schema.Number),
  parallelToolCalls: Schema.optional(Schema.Boolean),
  reasoningEffort: Schema.optional(Schema.String),
  promptMode: Schema.optional(Schema.Literal("reasoning")),
  promptCacheKey: Schema.optional(Schema.String),
})

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | (string & {})

export type ProviderOptionsInput = {
  readonly safePrompt?: boolean
  readonly documentImageLimit?: number
  readonly documentPageLimit?: number
  readonly parallelToolCalls?: boolean
  readonly reasoningEffort?: ReasoningEffort
  readonly promptMode?: "reasoning"
  readonly promptCacheKey?: string
  readonly [key: string]: unknown
}

const MistralBody = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(MistralMessage),
  tools: optionalArray(MistralTool),
  tool_choice: Schema.optional(
    Schema.Union([
      Schema.Literals(["auto", "none", "any"]),
      Schema.Struct({ type: Schema.Literal("function"), function: Schema.Struct({ name: Schema.String }) }),
    ]),
  ),
  stream: Schema.Literal(true),
  max_tokens: Schema.optional(Schema.Number),
  random_seed: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  frequency_penalty: Schema.optional(Schema.Number),
  presence_penalty: Schema.optional(Schema.Number),
  stop: optionalArray(Schema.String),
  prompt_cache_key: Schema.optional(Schema.String),
  safe_prompt: Schema.optional(Schema.Boolean),
  document_image_limit: Schema.optional(Schema.Number),
  document_page_limit: Schema.optional(Schema.Number),
  parallel_tool_calls: Schema.optional(Schema.Boolean),
  reasoning_effort: Schema.optional(Schema.String),
  prompt_mode: Schema.optional(Schema.Literal("reasoning")),
})
export type MistralBody = Schema.Schema.Type<typeof MistralBody>

const MistralUsageDetails = Schema.StructWithRest(Schema.Struct({ cached_tokens: optionalNull(Schema.Number) }), [
  Schema.Record(Schema.String, Schema.Unknown),
])

const MistralUsage = Schema.StructWithRest(
  Schema.Struct({
    prompt_tokens: optionalNull(Schema.Number),
    completion_tokens: optionalNull(Schema.Number),
    total_tokens: optionalNull(Schema.Number),
    num_cached_tokens: optionalNull(Schema.Number),
    prompt_token_details: optionalNull(MistralUsageDetails),
    prompt_tokens_details: optionalNull(MistralUsageDetails),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const MistralOutputContent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    text: optionalNull(Schema.String),
    thinking: optionalNull(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type MistralOutputContent = Schema.Schema.Type<typeof MistralOutputContent>

const MistralToolDelta = Schema.Struct({
  index: optionalNull(Schema.Number),
  id: optionalNull(Schema.String),
  function: optionalNull(
    Schema.Struct({
      name: optionalNull(Schema.String),
      arguments: optionalNull(Schema.Union([Schema.String, JsonObject])),
    }),
  ),
})
type MistralToolDelta = Schema.Schema.Type<typeof MistralToolDelta>

const MistralChoice = Schema.StructWithRest(
  Schema.Struct({
    delta: optionalNull(
      Schema.StructWithRest(
        Schema.Struct({
          content: optionalNull(Schema.Union([Schema.String, Schema.Array(MistralOutputContent)])),
          tool_calls: optionalNull(Schema.Array(MistralToolDelta)),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    finish_reason: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const MistralError = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    code: optionalNull(Schema.Union([Schema.String, Schema.Number])),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const MistralEvent = Schema.StructWithRest(
  Schema.Struct({
    choices: optionalNull(Schema.Array(MistralChoice)),
    usage: optionalNull(MistralUsage),
    error: optionalNull(MistralError),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type MistralEvent = Schema.Schema.Type<typeof MistralEvent>
const MistralStreamEvent = Schema.Union([Schema.Literal(DONE), Protocol.jsonEvent(MistralEvent)])

const hashID = (value: string) => {
  const hash = (seed: number) => {
    let result = seed
    for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
    return (result >>> 0).toString(36)
  }
  return `${hash(2166136261).padStart(7, "0")}${hash(2246822519).padStart(7, "0")}`.slice(-9)
}

const toolIDNormalizer = (request: LLMRequest) => {
  const ids = request.messages.flatMap((message) =>
    message.content.flatMap((part) => (part.type === "tool-call" || part.type === "tool-result" ? [part.id] : [])),
  )
  const used = new Set(ids.filter((id) => TOOL_ID.test(id)))
  const normalized = new Map<string, string>()
  return (id: string) => {
    if (TOOL_ID.test(id)) return id
    const previous = normalized.get(id)
    if (previous) return previous
    let attempt = 0
    let candidate = hashID(id)
    while (used.has(candidate)) candidate = hashID(`${id}:${++attempt}`)
    used.add(candidate)
    normalized.set(id, candidate)
    return candidate
  }
}

const lowerMedia = Effect.fn("MistralChat.lowerMedia")(function* (part: MediaPart) {
  const media = ProviderShared.normalizeMedia(part)
  const url = typeof part.data === "string" && /^(?:https?:|data:)/.test(part.data) ? part.data : media.dataUrl
  if (media.mime.startsWith("image/")) return { type: "image_url" as const, image_url: url }
  if (media.mime === "application/pdf") return { type: "document_url" as const, document_url: url }
  return yield* ProviderShared.invalidRequest(`Mistral Chat does not support media type ${part.mediaType}`)
})

const lowerUser = Effect.fn("MistralChat.lowerUser")(function* (message: LLMRequest["messages"][number]) {
  const content: MistralUserContent[] = []
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text })
      continue
    }
    if (part.type === "media") {
      content.push(yield* lowerMedia(part))
      continue
    }
    return yield* ProviderShared.unsupportedContent("Mistral Chat", "user", ["text", "media"])
  }
  if (content.every((part) => part.type === "text"))
    return { role: "user" as const, content: content.map((part) => part.text).join("") }
  return { role: "user" as const, content }
})

const lowerToolCall = (part: ToolCallPart, normalizeID: (id: string) => string): MistralAssistantToolCall => ({
  id: normalizeID(part.id),
  type: "function",
  function: { name: part.name, arguments: ProviderShared.encodeJson(part.input) },
})

const lowerAssistant = Effect.fn("MistralChat.lowerAssistant")(function* (
  message: LLMRequest["messages"][number],
  normalizeID: (id: string) => string,
  prefix: boolean,
) {
  const structured = message.content.some(
    (part) => part.type === "reasoning" && isMistralThinkingContent(part.providerMetadata?.mistral?.thinking),
  )
  const content: Array<Schema.Schema.Type<typeof MistralTextContent> | MistralThinkingContent> = []
  const text: string[] = []
  const toolCalls: MistralAssistantToolCall[] = []
  for (const part of message.content) {
    if (part.type === "text") {
      if (structured) content.push({ type: "text", text: part.text })
      else text.push(part.text)
      continue
    }
    if (part.type === "reasoning") {
      const native = part.providerMetadata?.mistral?.thinking
      if (structured && isMistralThinkingContent(native)) content.push(native)
      else if (structured) content.push({ type: "text", text: part.text })
      else text.push(part.text)
      continue
    }
    if (part.type === "tool-call") {
      toolCalls.push(lowerToolCall(part, normalizeID))
      continue
    }
    return yield* ProviderShared.unsupportedContent("Mistral Chat", "assistant", ["text", "reasoning", "tool-call"])
  }
  return {
    role: "assistant" as const,
    content: structured ? content : text.join(""),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(prefix ? { prefix: true as const } : {}),
  }
})

const lowerToolResults = Effect.fn("MistralChat.lowerToolResults")(function* (
  message: LLMRequest["messages"][number],
  normalizeID: (id: string) => string,
) {
  const output: MistralMessage[] = []
  for (const part of message.content) {
    if (part.type !== "tool-result")
      return yield* ProviderShared.unsupportedContent("Mistral Chat", "tool", ["tool-result"])
    if (part.result.type !== "content") {
      output.push({
        role: "tool",
        tool_call_id: normalizeID(part.id),
        name: part.name,
        content: ProviderShared.toolResultText(part),
      })
      continue
    }
    const content: MistralUserContent[] = []
    for (const item of part.result.value) {
      if (item.type === "text") {
        content.push({ type: "text", text: item.text })
        continue
      }
      content.push(yield* lowerMedia({ type: "media", mediaType: item.mime, data: item.uri, filename: item.name }))
    }
    output.push({
      role: "tool",
      tool_call_id: normalizeID(part.id),
      name: part.name,
      content: content.some((item) => item.type !== "text")
        ? content
        : content.map((item) => (item.type === "text" ? item.text : "")).join(""),
    })
  }
  return output
})

const lowerMessages = Effect.fn("MistralChat.lowerMessages")(function* (request: LLMRequest) {
  const normalizeID = toolIDNormalizer(request)
  const messages: MistralMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  for (const message of request.messages) {
    if (message.role === "system") {
      const update = yield* ProviderShared.wrappedSystemUpdate("Mistral Chat", message)
      messages.push({
        role: "user",
        content: update.text,
      })
      continue
    }
    if (message.role === "user") {
      messages.push(yield* lowerUser(message))
      continue
    }
    if (message.role === "assistant") {
      const hasToolCalls = message.content.some((part) => part.type === "tool-call")
      const hasNativeThinking = message.content.some(
        (part) => part.type === "reasoning" && isMistralThinkingContent(part.providerMetadata?.mistral?.thinking),
      )
      const text = message.content
        .flatMap((part) => (part.type === "text" || part.type === "reasoning" ? [part.text] : []))
        .join("")
      if (!hasToolCalls && !hasNativeThinking && text.trim() === "") continue
      messages.push(yield* lowerAssistant(message, normalizeID, !hasToolCalls && message === request.messages.at(-1)))
      continue
    }
    messages.push(...(yield* lowerToolResults(message, normalizeID)))
  }
  return messages
})

const lowerTool = (tool: ToolDefinition): MistralTool => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false },
})

export const fromRequest = Effect.fn("MistralChat.fromRequest")(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(MistralOptions))(
    request.providerOptions ?? {},
  )
  const selected = request.toolChoice?.type === "tool" ? request.toolChoice.name : undefined
  if (request.toolChoice?.type === "tool" && !selected)
    return yield* ProviderShared.invalidRequest("Mistral Chat tool choice requires a tool name")
  if (options.reasoningEffort !== undefined && options.promptMode !== undefined)
    return yield* ProviderShared.invalidRequest(
      "Mistral Chat reasoningEffort and promptMode provider options are mutually exclusive",
    )
  const toolChoice = request.toolChoice
    ? yield* ProviderShared.matchToolChoice("Mistral Chat", request.toolChoice, {
        auto: () => "auto" as const,
        none: () => "none" as const,
        required: () => "any" as const,
        tool: (name) => ({ type: "function" as const, function: { name } }),
      })
    : undefined
  const tools = yield* ProviderShared.requireFlatToolRequest("Mistral Chat", request)
  return {
    model: request.model.id,
    messages: yield* lowerMessages(request),
    tools: tools.length > 0 ? tools.map(lowerTool) : undefined,
    tool_choice: toolChoice,
    stream: true as const,
    max_tokens: request.generation?.maxTokens,
    random_seed: request.generation?.seed,
    temperature: request.generation?.temperature,
    top_p: request.generation?.topP,
    frequency_penalty: request.generation?.frequencyPenalty,
    presence_penalty: request.generation?.presencePenalty,
    stop: request.generation?.stop,
    prompt_cache_key: request.cache === "none" ? undefined : (options.promptCacheKey ?? request.promptCacheKey),
    safe_prompt: options.safePrompt,
    document_image_limit: options.documentImageLimit,
    document_page_limit: options.documentPageLimit,
    parallel_tool_calls:
      options.parallelToolCalls ?? (request.toolChoice?.disableParallelToolUse === true ? false : undefined),
    reasoning_effort: options.reasoningEffort,
    prompt_mode: options.promptMode,
  }
})

type ToolKey = string | number
interface PendingTool {
  readonly id: string
  readonly name?: string
  readonly input: string
}

interface ActiveContent {
  readonly type: "text" | "reasoning"
  readonly id: string
  readonly thinking?: MistralThinkingContent
}

export interface ParserState {
  readonly tools: ToolStream.State<ToolKey>
  readonly pendingTools: Partial<Record<ToolKey, PendingTool>>
  readonly toolIDs: ReadonlyMap<string, string>
  readonly usedToolIDs: ReadonlySet<string>
  readonly completedTools: ReadonlyArray<LLMEvent>
  readonly latestToolKey?: ToolKey
  readonly generatedTools: number
  readonly lifecycle: Lifecycle.State
  readonly active?: ActiveContent
  readonly nextContent: number
  readonly usage?: Usage
  readonly finishReason?: FinishReasonDetails
}

const mapUsage = (usage: MistralEvent["usage"]): Usage | undefined => {
  if (!usage) return undefined
  const input = usage.prompt_tokens ?? undefined
  const reported =
    usage.num_cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.prompt_token_details?.cached_tokens ??
    undefined
  const cached = input === undefined || reported === undefined ? undefined : Math.max(0, Math.min(input, reported))
  const output = usage.completion_tokens ?? undefined
  return new Usage({
    inputTokens: input,
    outputTokens: output,
    nonCachedInputTokens: ProviderShared.subtractTokens(input, cached),
    cacheReadInputTokens: cached,
    totalTokens: ProviderShared.totalTokens(input, output, usage.total_tokens ?? undefined),
    providerMetadata: { mistral: usage },
  })
}

const mapFinishReason = (reason: string) => {
  switch (reason) {
    case "stop":
      return "stop" as const
    case "length":
    case "model_length":
      return "length" as const
    case "tool_calls":
      return "tool-calls" as const
    case "content_filter":
      return "content-filter" as const
    case "error":
    case "network_error":
      return "error" as const
    default:
      return "unknown" as const
  }
}

const thinkingUnits = (value: unknown): ReadonlyArray<MistralThinkingUnit> => {
  if (typeof value === "string") return [{ type: "text", text: value }]
  if (!Array.isArray(value)) return []
  return value.filter(Schema.is(MistralThinkingUnit))
}

const thinkingText = (thinking: ReadonlyArray<MistralThinkingUnit>) =>
  thinking.flatMap((unit) => (typeof unit.text === "string" ? [unit.text] : [])).join("")

const thinkingMetadata = (thinking: MistralThinkingContent) => ({ mistral: { thinking } })

const closeActive = (state: ParserState, events: LLMEvent[]) => {
  if (!state.active) return state
  const lifecycle =
    state.active.type === "text"
      ? Lifecycle.textEnd(state.lifecycle, events, state.active.id)
      : Lifecycle.reasoningEnd(
          state.lifecycle,
          events,
          state.active.id,
          thinkingMetadata(state.active.thinking ?? { type: "thinking", thinking: [] }),
          thinkingText(state.active.thinking?.thinking ?? []),
        )
  return { ...state, lifecycle, active: undefined }
}

const appendText = (state: ParserState, events: LLMEvent[], text: string) => {
  if (text.length === 0) return state
  const current = state.active?.type === "text" ? state : closeActive(state, events)
  const active = current.active ?? { type: "text" as const, id: `text-${current.nextContent}` }
  return {
    ...current,
    lifecycle: Lifecycle.textDelta(current.lifecycle, events, active.id, text),
    active,
    nextContent: current.active ? current.nextContent : current.nextContent + 1,
  }
}

const appendThinking = (state: ParserState, events: LLMEvent[], part: MistralOutputContent) => {
  const current = state.active?.type === "reasoning" ? state : closeActive(state, events)
  const units = thinkingUnits(part.thinking)
  const active = current.active ?? { type: "reasoning" as const, id: `reasoning-${current.nextContent}` }
  const thinking = {
    ...active.thinking,
    ...part,
    type: "thinking" as const,
    thinking: [...(active.thinking?.thinking ?? []), ...units],
  }
  const text = thinkingText(units)
  return {
    ...current,
    lifecycle:
      text.length > 0
        ? Lifecycle.reasoningDelta(current.lifecycle, events, active.id, text, thinkingMetadata(thinking))
        : Lifecycle.reasoningStart(current.lifecycle, events, active.id, thinkingMetadata(thinking)),
    active: { ...active, thinking },
    nextContent: current.active ? current.nextContent : current.nextContent + 1,
  }
}

const appendContent = (
  state: ParserState,
  events: LLMEvent[],
  content: string | ReadonlyArray<MistralOutputContent>,
) => {
  if (typeof content === "string") return appendText(state, events, content)
  return content.reduce((current, part) => {
    if (part.type === "text") return appendText(current, events, part.text ?? "")
    if (part.type === "thinking") return appendThinking(current, events, part)
    return closeActive(current, events)
  }, state)
}

const normalizeStreamToolID = (state: ParserState, source: string) => {
  if (TOOL_ID.test(source))
    return { id: source, state: { ...state, usedToolIDs: new Set([...state.usedToolIDs, source]) } }
  const previous = state.toolIDs.get(source)
  if (previous) return { id: previous, state }
  let attempt = 0
  let id = hashID(source)
  while (state.usedToolIDs.has(id)) id = hashID(`${source}:${++attempt}`)
  return {
    id,
    state: {
      ...state,
      toolIDs: new Map([...state.toolIDs, [source, id]]),
      usedToolIDs: new Set([...state.usedToolIDs, id]),
    },
  }
}

const toolText = (tool: MistralToolDelta) => {
  const value = tool.function?.arguments
  if (typeof value === "string") return value
  return value === null || value === undefined ? "" : ProviderShared.encodeJson(value)
}

const appendTools = Effect.fn("MistralChat.appendTools")(function* (
  initial: ParserState,
  events: LLMEvent[],
  deltas: ReadonlyArray<MistralToolDelta>,
) {
  if (deltas.length === 0) return initial
  let state = closeActive(initial, events)
  for (const [position, delta] of deltas.entries()) {
    const wireID = delta.id?.trim() || undefined
    const providedID = wireID === "null" ? undefined : wireID
    const key =
      delta.index ??
      (providedID
        ? `id:${providedID}`
        : deltas.length > 1
          ? `position:${position}`
          : (state.latestToolKey ?? `missing:${state.generatedTools}`))
    const existing = state.tools[key]
    const pending = state.pendingTools[key]
    const source = providedID ?? `generated:${String(key)}`
    const normalized =
      existing || pending ? { id: existing?.id ?? pending?.id ?? "", state } : normalizeStreamToolID(state, source)
    state = normalized.state
    const name = existing?.name ?? pending?.name ?? (delta.function?.name?.trim() || undefined)
    const text = `${pending?.input ?? ""}${toolText(delta)}`
    if (!name) {
      state = {
        ...state,
        pendingTools: { ...state.pendingTools, [key]: { id: normalized.id, input: text } },
        latestToolKey: key,
        generatedTools: state.generatedTools + (!providedID && !pending ? 1 : 0),
      }
      continue
    }
    const result = ToolStream.appendOrStart(
      ADAPTER,
      state.tools,
      key,
      { id: normalized.id, name, text },
      "Mistral Chat tool call delta is missing a name",
    )
    if (ToolStream.isError(result)) return yield* result
    if (result.events.length > 0) state = { ...state, lifecycle: Lifecycle.stepStart(state.lifecycle, events) }
    events.push(...result.events)
    const pendingTools = { ...state.pendingTools }
    delete pendingTools[key]
    state = {
      ...state,
      tools: result.tools,
      pendingTools,
      latestToolKey: key,
      generatedTools: state.generatedTools + (!providedID && !existing && !pending ? 1 : 0),
    }
  }
  return state
})

const hasLateContent = (event: MistralEvent) => {
  const delta = event.choices?.[0]?.delta
  if (typeof delta?.content === "string" && delta.content.length > 0) return true
  if (Array.isArray(delta?.content) && delta.content.length > 0) return true
  return (delta?.tool_calls ?? []).some(
    (tool) => Boolean(tool.id) || Boolean(tool.function?.name) || tool.function?.arguments !== undefined,
  )
}

const step = Effect.fn("MistralChat.step")(function* (state: ParserState, event: MistralEvent) {
  if (event.error) {
    const body = ProviderShared.encodeJson(event)
    return yield* new AIError({
      reason: classifyProviderFailure({
        message: event.error.message,
        status: typeof event.error.code === "number" ? event.error.code : undefined,
        rawBody: body,
      }),
    })
  }
  const events: LLMEvent[] = []
  const usage = mapUsage(event.usage) ?? state.usage
  if (state.finishReason) {
    if (hasLateContent(event))
      return yield* ProviderShared.eventError(
        ADAPTER,
        "Mistral Chat received content after the finish reason",
        ProviderShared.encodeJson(event),
      )
    return [{ ...state, usage }, events] as const
  }
  const choice = event.choices?.[0]
  const withContent = choice?.delta?.content == null ? state : appendContent(state, events, choice.delta.content)
  const withTools = yield* appendTools(withContent, events, choice?.delta?.tool_calls ?? [])
  if (!choice?.finish_reason) return [{ ...withTools, usage }, events] as const

  const finishReason = {
    normalized: mapFinishReason(choice.finish_reason),
    raw: choice.finish_reason,
  }
  const incomplete = finishReason.normalized === "length" || finishReason.normalized === "content-filter"
  if (!incomplete && Object.keys(withTools.pendingTools).length > 0)
    return yield* ProviderShared.eventError(
      ADAPTER,
      "Mistral Chat tool call delta is missing a name",
      ProviderShared.encodeJson(event),
    )
  const finished =
    !incomplete && Object.keys(withTools.tools).length > 0
      ? yield* ToolStream.finishAll(ADAPTER, withTools.tools)
      : undefined
  return [
    {
      ...withTools,
      tools: finished?.tools ?? withTools.tools,
      completedTools: finished?.events ?? withTools.completedTools,
      usage,
      finishReason,
    },
    events,
  ] as const
})

const finishEvents = Effect.fn("MistralChat.finishEvents")(function* (state: ParserState) {
  if (!state.finishReason)
    return yield* new AIError({
      reason: new InvalidProviderOutputError({
        message: "Mistral Chat stream ended without finish_reason",
        classification: "incomplete-stream",
        route: ADAPTER,
      }),
    })
  const events: LLMEvent[] = []
  const closed = closeActive(state, events)
  const lifecycle = closed.completedTools.length > 0 ? Lifecycle.stepStart(closed.lifecycle, events) : closed.lifecycle
  events.push(...closed.completedTools)
  const reason =
    state.finishReason.normalized === "stop" && closed.completedTools.some(LLMEvent.is.toolCall)
      ? { ...state.finishReason, normalized: "tool-calls" as const }
      : state.finishReason
  Lifecycle.finish(lifecycle, events, { reason, usage: closed.usage })
  return events
})

export const protocol = Protocol.make({
  id: ADAPTER,
  body: { schema: MistralBody, from: fromRequest },
  stream: {
    event: MistralStreamEvent,
    initial: (): ParserState => ({
      tools: ToolStream.empty<ToolKey>(),
      pendingTools: {},
      toolIDs: new Map(),
      usedToolIDs: new Set(),
      completedTools: [],
      generatedTools: 0,
      lifecycle: Lifecycle.initial(),
      nextContent: 0,
    }),
    step: (state: ParserState, event) => (event === DONE ? Effect.succeed([state, []] as const) : step(state, event)),
    terminal: (event) => event === DONE,
    onHalt: finishEvents,
  },
})

export const framing = Framing.sseWithDone
export const httpTransport = HttpTransport.sseJson.with<MistralBody>().with({ framing })

export const route = Route.make({
  id: ADAPTER,
  provider: "mistral",
  providerMetadataKey: "mistral",
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  transport: httpTransport,
})

export * as MistralChat from "./mistral-chat.js"
