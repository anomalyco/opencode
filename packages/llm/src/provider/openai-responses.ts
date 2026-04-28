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

const ADAPTER = "openai-responses"

export type OpenAIResponsesModelInput = Omit<ModelInput, "provider" | "protocol" | "headers"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

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
  parameters: Schema.Record(Schema.String, Schema.Unknown),
  strict: Schema.optional(Schema.Boolean),
})
type OpenAIResponsesTool = Schema.Schema.Type<typeof OpenAIResponsesTool>

const OpenAIResponsesToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({ type: Schema.Literal("function"), name: Schema.String }),
])

const OpenAIResponsesTargetFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  tools: Schema.optional(Schema.Array(OpenAIResponsesTool)),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  stream: Schema.Literal(true),
  max_output_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
}
const OpenAIResponsesDraft = Schema.Struct(OpenAIResponsesTargetFields)
type OpenAIResponsesDraft = Schema.Schema.Type<typeof OpenAIResponsesDraft>
const OpenAIResponsesTarget = Schema.Struct(OpenAIResponsesTargetFields)
export type OpenAIResponsesTarget = Schema.Schema.Type<typeof OpenAIResponsesTarget>

const OpenAIResponsesUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  input_tokens_details: Schema.optional(Schema.NullOr(Schema.Struct({ cached_tokens: Schema.optional(Schema.Number) }))),
  output_tokens: Schema.optional(Schema.Number),
  output_tokens_details: Schema.optional(Schema.NullOr(Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) }))),
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
      incomplete_details: Schema.optional(Schema.NullOr(Schema.Struct({ reason: Schema.String }))),
      usage: Schema.optional(OpenAIResponsesUsage),
    }),
  ),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
type OpenAIResponsesChunk = Schema.Schema.Type<typeof OpenAIResponsesChunk>

const { encodeTarget, decodeTarget, decodeChunk } = ProviderShared.codecs({
  adapter: ADAPTER,
  draft: OpenAIResponsesDraft,
  target: OpenAIResponsesTarget,
  chunk: OpenAIResponsesChunk,
  chunkErrorMessage: "Invalid OpenAI Responses stream chunk",
})

interface ParserState {
  readonly tools: Record<string, ProviderShared.ToolAccumulator>
}

const invalid = ProviderShared.invalidRequest

const baseUrl = (request: LLMRequest) => ProviderShared.trimBaseUrl(request.model.baseURL ?? "https://api.openai.com/v1")

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

const prepare = Effect.fn("OpenAIResponses.prepare")(function* (request: LLMRequest) {
  return {
    model: request.model.id,
    input: yield* lowerMessages(request),
    tools: request.tools.length === 0 ? undefined : request.tools.map(lowerTool),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    max_output_tokens: request.generation.maxTokens,
    temperature: request.generation.temperature,
    top_p: request.generation.topP,
  }
})

const toHttp = (target: OpenAIResponsesTarget, request: LLMRequest) =>
  Effect.succeed(
    ProviderShared.jsonPost({
      url: ProviderShared.withQuery(`${baseUrl(request)}/responses`, ProviderShared.queryParams(request)),
      body: encodeTarget(target),
      headers: request.model.headers,
    }),
  )

const mapUsage = (usage: OpenAIResponsesUsage | undefined) => {
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

const mapFinishReason = (chunk: OpenAIResponsesChunk): FinishReason => {
  if (chunk.type === "response.completed") return "stop"
  if (chunk.response?.incomplete_details?.reason === "max_output_tokens") return "length"
  if (chunk.response?.incomplete_details?.reason === "content_filter") return "content-filter"
  return "unknown"
}

const pushToolDelta = (tools: Record<string, ProviderShared.ToolAccumulator>, itemId: string, delta: string) =>
  Effect.gen(function* () {
    const current = tools[itemId]
    if (!current) {
      return yield* ProviderShared.chunkError(ADAPTER, "OpenAI Responses tool argument delta is missing its tool call")
    }
    return { ...current, input: `${current.input}${delta}` }
  })

const finishToolCall = (tools: Record<string, ProviderShared.ToolAccumulator>, item: NonNullable<OpenAIResponsesChunk["item"]>) =>
  Effect.gen(function* () {
    if (item.type !== "function_call" || !item.id || !item.call_id || !item.name) return [] as ReadonlyArray<LLMEvent>
    const raw = item.arguments ?? tools[item.id]?.input ?? ""
    const input = yield* ProviderShared.parseToolInput(ADAPTER, item.name, raw)
    return [{ type: "tool-call" as const, id: item.call_id, name: item.name, input }]
  })

const withoutTool = (tools: Record<string, ProviderShared.ToolAccumulator>, id: string | undefined) =>
  id === undefined ? tools : Object.fromEntries(Object.entries(tools).filter(([key]) => key !== id))

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
        tools: {
          ...state.tools,
          [chunk.item.id]: {
            id: chunk.item.call_id ?? chunk.item.id,
            name: chunk.item.name ?? "",
            input: chunk.item.arguments ?? "",
          },
        },
      }, []] as const
    }

    if (chunk.type === "response.function_call_arguments.delta" && chunk.item_id && chunk.delta) {
      const current = yield* pushToolDelta(state.tools, chunk.item_id, chunk.delta)
      return [{ tools: { ...state.tools, [chunk.item_id]: current } }, [
        { type: "tool-input-delta" as const, id: current.id, name: current.name, text: chunk.delta },
      ]] as const
    }

    if (chunk.type === "response.output_item.done" && chunk.item?.type === "function_call") {
      const events = yield* finishToolCall(state.tools, chunk.item)
      return [{ tools: withoutTool(state.tools, chunk.item.id) }, events] as const
    }

    if (chunk.type === "response.output_item.done" && chunk.item && isHostedToolItem(chunk.item)) {
      return [state, hostedToolEvents(chunk.item)] as const
    }

    if (chunk.type === "response.completed" || chunk.type === "response.incomplete") {
      return [state, [{ type: "request-finish" as const, reason: mapFinishReason(chunk), usage: mapUsage(chunk.response?.usage) }]] as const
    }

    if (chunk.type === "error") {
      return [state, [{ type: "provider-error" as const, message: chunk.message ?? chunk.code ?? "OpenAI Responses stream error" }]] as const
    }

    return [state, []] as const
  })

const events = (response: HttpClientResponse.HttpClientResponse) =>
  ProviderShared.sse({
    adapter: ADAPTER,
    response,
    readError: "Failed to read OpenAI Responses stream",
    decodeChunk,
    initial: (): ParserState => ({ tools: {} }),
    process: processChunk,
  })

export const adapter = Adapter.define<OpenAIResponsesDraft, OpenAIResponsesTarget>({
  id: ADAPTER,
  protocol: "openai-responses",
  redact: (target) => target,
  prepare,
  validate: ProviderShared.validateWith(decodeTarget),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: events,
})

export const model = (input: OpenAIResponsesModelInput) => {
  const { apiKey, headers, ...rest } = input
  return llmModel({
    ...rest,
    provider: "openai",
    protocol: "openai-responses",
    headers: apiKey ? { ...headers, authorization: `Bearer ${apiKey}` } : headers,
    capabilities: input.capabilities ?? capabilities({ tools: { calls: true, streamingInput: true } }),
  })
}

export * as OpenAIResponses from "./openai-responses"
