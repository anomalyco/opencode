import { Buffer } from "node:buffer"
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
  type MediaPart,
  type ReasoningEffort,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "gemini"

export type GeminiModelInput = Omit<ModelInput, "provider" | "protocol" | "headers"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

const GeminiTextPart = Schema.Struct({
  text: Schema.String,
  thought: Schema.optional(Schema.Boolean),
  thoughtSignature: Schema.optional(Schema.String),
})

const GeminiInlineDataPart = Schema.Struct({
  inlineData: Schema.Struct({
    mimeType: Schema.String,
    data: Schema.String,
  }),
})

const GeminiFunctionCallPart = Schema.Struct({
  functionCall: Schema.Struct({
    name: Schema.String,
    args: Schema.Unknown,
  }),
  thoughtSignature: Schema.optional(Schema.String),
})

const GeminiFunctionResponsePart = Schema.Struct({
  functionResponse: Schema.Struct({
    name: Schema.String,
    response: Schema.Unknown,
  }),
})

const GeminiContentPart = Schema.Union([
  GeminiTextPart,
  GeminiInlineDataPart,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
])

const GeminiContent = Schema.Struct({
  role: Schema.Literals(["user", "model"]),
  parts: Schema.Array(GeminiContentPart),
})
type GeminiContent = Schema.Schema.Type<typeof GeminiContent>

const GeminiSystemInstruction = Schema.Struct({
  parts: Schema.Array(Schema.Struct({ text: Schema.String })),
})

const GeminiFunctionDeclaration = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const GeminiTool = Schema.Struct({
  functionDeclarations: Schema.Array(GeminiFunctionDeclaration),
})

const GeminiToolConfig = Schema.Struct({
  functionCallingConfig: Schema.Struct({
    mode: Schema.Literals(["AUTO", "NONE", "ANY"]),
    allowedFunctionNames: Schema.optional(Schema.Array(Schema.String)),
  }),
})

const GeminiThinkingConfig = Schema.Struct({
  thinkingBudget: Schema.optional(Schema.Number),
  includeThoughts: Schema.optional(Schema.Boolean),
})

const GeminiGenerationConfig = Schema.Struct({
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
  thinkingConfig: Schema.optional(GeminiThinkingConfig),
})

const GeminiTargetFields = {
  contents: Schema.Array(GeminiContent),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: Schema.optional(Schema.Array(GeminiTool)),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
}
const GeminiDraft = Schema.Struct(GeminiTargetFields)
type GeminiDraft = Schema.Schema.Type<typeof GeminiDraft>
const GeminiTarget = Schema.Struct(GeminiTargetFields)
export type GeminiTarget = Schema.Schema.Type<typeof GeminiTarget>

const GeminiUsage = Schema.Struct({
  cachedContentTokenCount: Schema.optional(Schema.Number),
  thoughtsTokenCount: Schema.optional(Schema.Number),
  promptTokenCount: Schema.optional(Schema.Number),
  candidatesTokenCount: Schema.optional(Schema.Number),
  totalTokenCount: Schema.optional(Schema.Number),
})
type GeminiUsage = Schema.Schema.Type<typeof GeminiUsage>

const GeminiCandidate = Schema.Struct({
  content: Schema.optional(GeminiContent),
  finishReason: Schema.optional(Schema.String),
})

const GeminiChunk = Schema.Struct({
  candidates: Schema.optional(Schema.Array(GeminiCandidate)),
  usageMetadata: Schema.optional(GeminiUsage),
})
type GeminiChunk = Schema.Schema.Type<typeof GeminiChunk>

interface ParserState {
  readonly finishReason?: string
  readonly hasToolCalls: boolean
  readonly nextToolCallId: number
  readonly usage?: Usage
}

const GeminiChunkJson = Schema.fromJsonString(GeminiChunk)
const GeminiTargetJson = Schema.fromJsonString(GeminiTarget)
const decodeChunkSync = Schema.decodeUnknownSync(GeminiChunkJson)

const decodeChunk = (data: string) =>
  Effect.try({
    try: () => decodeChunkSync(data),
    catch: () => ProviderShared.chunkError(ADAPTER, "Invalid Gemini stream chunk", data),
  })
const encodeTarget = Schema.encodeSync(GeminiTargetJson)
const decodeTarget = Schema.decodeUnknownEffect(GeminiDraft.pipe(Schema.decodeTo(GeminiTarget)))

const invalid = (message: string) => new InvalidRequestError({ message })

const baseUrl = (request: LLMRequest) =>
  (request.model.baseURL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")

const text = (values: ReadonlyArray<{ readonly text: string }>) => values.map((part) => part.text).join("\n")

const mediaData = (part: MediaPart) => typeof part.data === "string" ? part.data : Buffer.from(part.data).toString("base64")

const resultText = (part: ToolResultPart) => {
  if (part.result.type === "text" || part.result.type === "error") return String(part.result.value)
  return ProviderShared.encodeJson(part.result.value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const emptyObjectSchema = (schema: Record<string, unknown>) =>
  schema.type === "object" && (!isRecord(schema.properties) || Object.keys(schema.properties).length === 0) &&
  !schema.additionalProperties

const convertJsonSchema = (schema: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(schema)) return undefined
  if (emptyObjectSchema(schema)) return undefined
  return Object.fromEntries(
    [
      ["description", schema.description],
      ["required", schema.required],
      ["format", schema.format],
      ["type", Array.isArray(schema.type) ? schema.type.filter((type) => type !== "null")[0] : schema.type],
      ["nullable", Array.isArray(schema.type) && schema.type.includes("null") ? true : undefined],
      ["enum", schema.const !== undefined ? [schema.const] : schema.enum],
      ["properties", isRecord(schema.properties)
        ? Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [key, convertJsonSchema(value)]),
          )
        : undefined],
      ["items", Array.isArray(schema.items)
        ? schema.items.map(convertJsonSchema)
        : schema.items === undefined
        ? undefined
        : convertJsonSchema(schema.items)],
      ["allOf", Array.isArray(schema.allOf) ? schema.allOf.map(convertJsonSchema) : undefined],
      ["anyOf", Array.isArray(schema.anyOf) ? schema.anyOf.map(convertJsonSchema) : undefined],
      ["oneOf", Array.isArray(schema.oneOf) ? schema.oneOf.map(convertJsonSchema) : undefined],
      ["minLength", schema.minLength],
    ].filter((entry) => entry[1] !== undefined),
  )
}

const lowerTool = (tool: ToolDefinition) => ({
  name: tool.name,
  description: tool.description,
  parameters: convertJsonSchema(tool.inputSchema),
})

const lowerToolConfig = (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
): Effect.Effect<GeminiTarget["toolConfig"], InvalidRequestError> => {
  if (toolChoice.type === "tool") {
    if (!toolChoice.name) return Effect.fail(invalid("Gemini tool choice requires a tool name"))
    return Effect.succeed({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [toolChoice.name] },
    })
  }

  if (toolChoice.type === "required") return Effect.succeed({ functionCallingConfig: { mode: "ANY" } })
  if (toolChoice.type === "none") return Effect.succeed({ functionCallingConfig: { mode: "NONE" } })
  return Effect.succeed({ functionCallingConfig: { mode: "AUTO" } })
}

const lowerUserPart = (part: TextPart | MediaPart) =>
  part.type === "text"
    ? { text: part.text }
    : { inlineData: { mimeType: part.mediaType, data: mediaData(part) } }

const lowerToolCall = (part: ToolCallPart) => ({
  functionCall: { name: part.name, args: part.input },
})

const lowerMessages = Effect.fn("Gemini.lowerMessages")(function* (request: LLMRequest) {
  const contents: GeminiContent[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (part.type !== "text" && part.type !== "media")
          return yield* invalid("Gemini user messages only support text and media content for now")
        parts.push(lowerUserPart(part))
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({ text: part.text })
          continue
        }
        if (part.type === "reasoning") {
          parts.push({ text: part.text, thought: true })
          continue
        }
        if (part.type === "tool-call") {
          parts.push(lowerToolCall(part))
          continue
        }
        return yield* invalid("Gemini assistant messages only support text, reasoning, and tool-call content for now")
      }
      contents.push({ role: "model", parts })
      continue
    }

    const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
    for (const part of message.content) {
      if (part.type !== "tool-result") return yield* invalid("Gemini tool messages only support tool-result content")
      parts.push({
        functionResponse: {
          name: part.name,
          response: {
            name: part.name,
            content: resultText(part),
          },
        },
      })
    }
    contents.push({ role: "user", parts })
  }

  return contents
})

const thinkingBudget = (effort: ReasoningEffort | undefined) => {
  if (effort === "minimal" || effort === "low") return 1024
  if (effort === "high") return 16000
  if (effort === "xhigh") return 24576
  if (effort === "max") return 32768
  return 8192
}

const prepare = Effect.fn("Gemini.prepare")(function* (request: LLMRequest) {
  const toolsEnabled = request.tools.length > 0 && request.toolChoice?.type !== "none"
  const generationConfig = {
    maxOutputTokens: request.generation.maxTokens,
    temperature: request.generation.temperature,
    topP: request.generation.topP,
    stopSequences: request.generation.stop,
    thinkingConfig: request.reasoning?.enabled
      ? {
          includeThoughts: true,
          thinkingBudget: thinkingBudget(request.reasoning.effort),
        }
      : undefined,
  }

  return {
    contents: yield* lowerMessages(request),
    systemInstruction: request.system.length === 0 ? undefined : { parts: [{ text: text(request.system) }] },
    tools: toolsEnabled ? [{ functionDeclarations: request.tools.map(lowerTool) }] : undefined,
    toolConfig: toolsEnabled && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined) ? generationConfig : undefined,
  }
})

const toHttp = (target: GeminiTarget, request: LLMRequest) =>
  Effect.succeed(
    HttpClientRequest.post(`${baseUrl(request)}/models/${request.model.id}:streamGenerateContent?alt=sse`).pipe(
      HttpClientRequest.setHeaders({
        ...request.model.headers,
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyText(encodeTarget(target), "application/json"),
    ),
  )

const mapUsage = (usage: GeminiUsage | undefined) => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    reasoningTokens: usage.thoughtsTokenCount,
    cacheReadInputTokens: usage.cachedContentTokenCount,
    totalTokens: usage.totalTokenCount ??
      (usage.promptTokenCount !== undefined || usage.candidatesTokenCount !== undefined
        ? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0)
        : undefined),
    native: usage,
  })
}

const mapFinishReason = (finishReason: string | undefined, hasToolCalls: boolean): FinishReason => {
  if (finishReason === "STOP") return hasToolCalls ? "tool-calls" : "stop"
  if (finishReason === "MAX_TOKENS") return "length"
  if (
    finishReason === "IMAGE_SAFETY" ||
    finishReason === "RECITATION" ||
    finishReason === "SAFETY" ||
    finishReason === "BLOCKLIST" ||
    finishReason === "PROHIBITED_CONTENT" ||
    finishReason === "SPII"
  )
    return "content-filter"
  if (finishReason === "MALFORMED_FUNCTION_CALL") return "error"
  return "unknown"
}

const finish = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.finishReason || state.usage
    ? [{ type: "request-finish", reason: mapFinishReason(state.finishReason, state.hasToolCalls), usage: state.usage }]
    : []

const processChunk = (state: ParserState, chunk: GeminiChunk) => {
  const nextState = {
    ...state,
    usage: chunk.usageMetadata ? mapUsage(chunk.usageMetadata) ?? state.usage : state.usage,
  }
  const candidate = chunk.candidates?.[0]
  if (!candidate?.content) {
    return Effect.succeed([{ ...nextState, finishReason: candidate?.finishReason ?? nextState.finishReason }, []] as const)
  }

  const events: LLMEvent[] = []
  let hasToolCalls = nextState.hasToolCalls
  let nextToolCallId = nextState.nextToolCallId

  for (const part of candidate.content.parts) {
    if ("text" in part && part.text.length > 0) {
      events.push({ type: part.thought ? "reasoning-delta" : "text-delta", text: part.text })
      continue
    }

    if ("functionCall" in part) {
      const input = part.functionCall.args
      const id = `tool_${nextToolCallId++}`
      events.push({ type: "tool-call", id, name: part.functionCall.name, input })
      hasToolCalls = true
    }
  }

  return Effect.succeed([{
    ...nextState,
    hasToolCalls,
    nextToolCallId,
    finishReason: candidate.finishReason ?? nextState.finishReason,
  }, events] as const)
}

const events = (response: HttpClientResponse.HttpClientResponse) =>
  ProviderShared.sse({
    adapter: ADAPTER,
    response,
    readError: "Failed to read Gemini stream",
    decodeChunk,
    initial: (): ParserState => ({ hasToolCalls: false, nextToolCallId: 0 }),
    process: processChunk,
    onHalt: finish,
  })

export const adapter = Adapter.define<GeminiDraft, GeminiTarget, LLMEvent>({
  id: ADAPTER,
  protocol: "gemini",
  redact: (target) => target,
  prepare,
  validate: (draft) => decodeTarget(draft).pipe(Effect.mapError((error) => invalid(error.message))),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: events,
  raise: (event) => Stream.make(event),
})

export const model = (input: GeminiModelInput) => {
  const { apiKey, headers, ...rest } = input
  return llmModel({
    ...rest,
    provider: "google",
    protocol: "gemini",
    headers: apiKey ? { ...headers, "x-goog-api-key": apiKey } : headers,
    capabilities: input.capabilities ?? capabilities({
      input: { image: true, audio: true, video: true, pdf: true },
      output: { reasoning: true },
      tools: { calls: true },
      reasoning: { efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    }),
  })
}

export * as Gemini from "./gemini"
