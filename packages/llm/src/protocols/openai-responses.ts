import { Effect, Schema } from "effect"
import { Adapter, type AdapterModelInput } from "../adapter"
import { Auth } from "../auth"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
import { capabilities } from "../llm"
import { Protocol } from "../protocol"
import {
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { OpenAIOptions } from "./utils/openai-options"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "openai-responses"

// =============================================================================
// Public Model Input
// =============================================================================
export type OpenAIResponsesModelInput = AdapterModelInput

// =============================================================================
// Request Payload Schema
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

const OpenAIResponsesPayloadFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  tools: optionalArray(OpenAIResponsesTool),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  stream: Schema.Literal(true),
  store: Schema.optional(Schema.Boolean),
  prompt_cache_key: Schema.optional(Schema.String),
  include: optionalArray(Schema.Literal("reasoning.encrypted_content")),
  reasoning: Schema.optional(Schema.Struct({
    effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
    summary: Schema.optional(Schema.Literal("auto")),
  })),
  text: Schema.optional(Schema.Struct({
    verbosity: Schema.optional(OpenAIOptions.OpenAITextVerbosity),
  })),
  max_output_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
}
const OpenAIResponsesPayload = Schema.Struct(OpenAIResponsesPayloadFields)
export type OpenAIResponsesPayload = Schema.Schema.Type<typeof OpenAIResponsesPayload>

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

const OpenAIResponsesChunk = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(Schema.String),
  item_id: Schema.optional(Schema.String),
  item: Schema.optional(OpenAIResponsesStreamItem),
  response: Schema.optional(
    Schema.Struct({
      incomplete_details: optionalNull(Schema.Struct({ reason: Schema.String })),
      usage: optionalNull(OpenAIResponsesUsage),
    }),
  ),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
type OpenAIResponsesChunk = Schema.Schema.Type<typeof OpenAIResponsesChunk>

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

const lowerToolChoice = Effect.fn("OpenAIResponses.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type !== "tool") return toolChoice.type
  if (!toolChoice.name) return yield* invalid("OpenAI Responses tool choice requires a tool name")
  return { type: "function" as const, name: toolChoice.name }
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
        if (part.type !== "text") return yield* invalid(`OpenAI Responses user messages only support text content for now`)
        content.push(part)
      }
      input.push({ role: "user", content: content.map((part) => ({ type: "input_text", text: part.text })) })
      continue
    }

    if (message.role === "assistant") {
      const content: TextPart[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(part)
          continue
        }
        if (part.type === "tool-call") {
          input.push(lowerToolCall(part))
          continue
        }
        return yield* invalid(`OpenAI Responses assistant messages only support text and tool-call content for now`)
      }
      if (content.length > 0)
        input.push({ role: "assistant", content: content.map((part) => ({ type: "output_text", text: part.text })) })
      continue
    }

    for (const part of message.content) {
      if (part.type !== "tool-result")
        return yield* invalid(`OpenAI Responses tool messages only support tool-result content`)
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

const toPayload = Effect.fn("OpenAIResponses.toPayload")(function* (request: LLMRequest) {
  return {
    model: request.model.id,
    input: yield* lowerMessages(request),
    tools: request.tools.length === 0 ? undefined : request.tools.map(lowerTool),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    max_output_tokens: request.generation.maxTokens,
    temperature: request.generation.temperature,
    top_p: request.generation.topP,
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

const mapFinishReason = (chunk: OpenAIResponsesChunk, hasFunctionCall: boolean): FinishReason => {
  const reason = chunk.response?.incomplete_details?.reason
  if (reason === undefined || reason === null) return hasFunctionCall ? "tool-calls" : "stop"
  if (reason === "max_output_tokens") return "length"
  if (reason === "content_filter") return "content-filter"
  return hasFunctionCall ? "tool-calls" : "unknown"
}

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
  return isError
    ? ({ type: "error" as const, value: item.error })
    : ({ type: "json" as const, value: item })
}

const hostedToolEvents = (item: OpenAIResponsesStreamItem & { id: string }): ReadonlyArray<LLMEvent> => {
  const name = HOSTED_TOOL_NAMES[item.type]
  return [
    { type: "tool-call", id: item.id, name, input: hostedToolInput(item), providerExecuted: true },
    { type: "tool-result", id: item.id, name, result: hostedToolResult(item), providerExecuted: true },
  ]
}

const processChunk = (state: ParserState, chunk: OpenAIResponsesChunk) =>
  Effect.gen(function* () {
    if (chunk.type === "response.output_text.delta" && chunk.delta) {
      return [state, [{ type: "text-delta", id: chunk.item_id, text: chunk.delta }]] as const
    }

    if (chunk.type === "response.output_item.added" && chunk.item?.type === "function_call" && chunk.item.id) {
      return [{
        hasFunctionCall: state.hasFunctionCall,
        tools: ToolStream.start(state.tools, chunk.item.id, {
          id: chunk.item.call_id ?? chunk.item.id,
          name: chunk.item.name ?? "",
          input: chunk.item.arguments ?? "",
        }),
      }, []] as const
    }

    if (chunk.type === "response.function_call_arguments.delta" && chunk.item_id && chunk.delta) {
      const result = ToolStream.appendExisting(
        ADAPTER,
        state.tools,
        chunk.item_id,
        chunk.delta,
        "OpenAI Responses tool argument delta is missing its tool call",
      )
      if (ToolStream.isError(result)) return yield* result
      return [{ hasFunctionCall: state.hasFunctionCall, tools: result.tools }, result.event ? [result.event] : []] as const
    }

    if (chunk.type === "response.output_item.done" && chunk.item?.type === "function_call") {
      if (!chunk.item.id || !chunk.item.call_id || !chunk.item.name) return [state, []] as const
      const tools = state.tools[chunk.item.id]
        ? state.tools
        : ToolStream.start(state.tools, chunk.item.id, { id: chunk.item.call_id, name: chunk.item.name })
      const result = chunk.item.arguments === undefined
        ? yield* ToolStream.finish(ADAPTER, tools, chunk.item.id)
        : yield* ToolStream.finishWithInput(ADAPTER, tools, chunk.item.id, chunk.item.arguments)
      return [{
        hasFunctionCall: result.event ? true : state.hasFunctionCall,
        tools: result.tools,
      }, result.event ? [result.event] : []] as const
    }

    if (chunk.type === "response.output_item.done" && chunk.item && isHostedToolItem(chunk.item)) {
      return [state, hostedToolEvents(chunk.item)] as const
    }

    if (chunk.type === "response.completed" || chunk.type === "response.incomplete")
      return [
        state,
        [{ type: "request-finish" as const, reason: mapFinishReason(chunk, state.hasFunctionCall), usage: mapUsage(chunk.response?.usage) }],
      ] as const

    if (chunk.type === "error") {
      return [state, [{ type: "provider-error" as const, message: chunk.message ?? chunk.code ?? "OpenAI Responses stream error" }]] as const
    }

    return [state, []] as const
  })

// =============================================================================
// Protocol And OpenAI Adapter
// =============================================================================
/**
 * The OpenAI Responses protocol — request lowering, payload schema, and the
 * streaming-chunk state machine. Used by native OpenAI and
 * (once registered) Azure OpenAI Responses.
 */
export const protocol = Protocol.define({
  id: ADAPTER,
  payload: OpenAIResponsesPayload,
  toPayload,
  chunk: Protocol.jsonChunk(OpenAIResponsesChunk),
  initial: () => ({ hasFunctionCall: false, tools: ToolStream.empty<string>() }),
  process: processChunk,
})

export const adapter = Adapter.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.baseURL({ default: "https://api.openai.com/v1", path: "/responses" }),
  auth: Auth.openAI,
  framing: Framing.sse,
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = Adapter.model(adapter, {
  provider: "openai",
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

export * as OpenAIResponses from "./openai-responses"
