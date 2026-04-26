import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  InvalidRequestError,
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
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
})

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

const OpenAIResponsesChunkJson = Schema.fromJsonString(OpenAIResponsesChunk)
const OpenAIResponsesTargetJson = Schema.fromJsonString(OpenAIResponsesTarget)
const decodeChunkSync = Schema.decodeUnknownSync(OpenAIResponsesChunkJson)

const decodeChunk = (data: string) =>
  Effect.try({
    try: () => decodeChunkSync(data),
    catch: () => ProviderShared.chunkError(ADAPTER, "Invalid OpenAI Responses stream chunk", data),
  })
const encodeTarget = Schema.encodeSync(OpenAIResponsesTargetJson)
const decodeTarget = Schema.decodeUnknownEffect(OpenAIResponsesDraft.pipe(Schema.decodeTo(OpenAIResponsesTarget)))

interface ToolAccumulator {
  readonly id: string
  readonly name: string
  readonly input: string
}

interface ParserState {
  readonly tools: Record<string, ToolAccumulator>
}

const invalid = (message: string) => new InvalidRequestError({ message })

const baseUrl = (request: LLMRequest) => (request.model.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "")

const text = (values: ReadonlyArray<{ readonly text: string }>) => values.map((part) => part.text).join("\n")

const resultText = (part: ToolResultPart) => {
  if (part.result.type === "text" || part.result.type === "error") return String(part.result.value)
  return ProviderShared.encodeJson(part.result.value)
}

const lowerTool = (tool: ToolDefinition): OpenAIResponsesTool => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
})

const lowerToolChoice = (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
): Effect.Effect<NonNullable<OpenAIResponsesDraft["tool_choice"]>, InvalidRequestError> => {
  if (toolChoice.type === "tool") {
    if (!toolChoice.name) return Effect.fail(invalid(`OpenAI Responses tool choice requires a tool name`))
    return Effect.succeed({ type: "function", name: toolChoice.name })
  }
  return Effect.succeed(toolChoice.type)
}

const lowerToolCall = (part: ToolCallPart): OpenAIResponsesInputItem => ({
  type: "function_call",
  call_id: part.id,
  name: part.name,
  arguments: ProviderShared.encodeJson(part.input),
})

const lowerMessages = Effect.fn("OpenAIResponses.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIResponsesInputItem[] =
    request.system.length === 0 ? [] : [{ role: "system", content: text(request.system) }]
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
      input.push({ type: "function_call_output", call_id: part.id, output: resultText(part) })
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
    HttpClientRequest.post(`${baseUrl(request)}/responses`).pipe(
      HttpClientRequest.setHeaders({
        ...request.model.headers,
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyText(encodeTarget(target), "application/json"),
    ),
  )

const mapUsage = (usage: OpenAIResponsesUsage | undefined) => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    cacheReadInputTokens: usage.input_tokens_details?.cached_tokens,
    totalTokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    native: usage,
  })
}

const mapFinishReason = (chunk: OpenAIResponsesChunk): FinishReason => {
  if (chunk.type === "response.completed") return "stop"
  if (chunk.response?.incomplete_details?.reason === "max_output_tokens") return "length"
  if (chunk.response?.incomplete_details?.reason === "content_filter") return "content-filter"
  return "unknown"
}

const pushToolDelta = (tools: Record<string, ToolAccumulator>, itemId: string, delta: string) =>
  Effect.gen(function* () {
    const current = tools[itemId]
    if (!current) {
      return yield* ProviderShared.chunkError(ADAPTER, "OpenAI Responses tool argument delta is missing its tool call")
    }
    return { ...current, input: `${current.input}${delta}` }
  })

const finishToolCall = (tools: Record<string, ToolAccumulator>, item: NonNullable<OpenAIResponsesChunk["item"]>) =>
  Effect.gen(function* () {
    if (item.type !== "function_call" || !item.id || !item.call_id || !item.name) return [] as ReadonlyArray<LLMEvent>
    const raw = item.arguments ?? tools[item.id]?.input ?? "{}"
    const input = yield* ProviderShared.parseJson(
      ADAPTER,
      raw || "{}",
      `Invalid JSON input for OpenAI Responses tool call ${item.name}`,
    )
    return [{ type: "tool-call" as const, id: item.call_id, name: item.name, input }]
  })

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
      return [state, events] as const
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

export const adapter = Adapter.define<OpenAIResponsesDraft, OpenAIResponsesTarget, LLMEvent>({
  id: ADAPTER,
  protocol: "openai-responses",
  redact: (target) => target,
  prepare,
  validate: (draft) => decodeTarget(draft).pipe(Effect.mapError((error) => invalid(error.message))),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: events,
  raise: (event) => Stream.make(event),
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
