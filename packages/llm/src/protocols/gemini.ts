import { Effect, Schema } from "effect"
import { Adapter, type AdapterModelInput } from "../adapter/client"
import { Auth } from "../adapter/auth"
import { Endpoint } from "../adapter/endpoint"
import { Framing } from "../adapter/framing"
import { capabilities } from "../llm"
import { Protocol } from "../adapter/protocol"
import {
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type MediaPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { JsonObject, optionalArray, ProviderShared } from "./shared"
import { GeminiToolSchema } from "./utils/gemini-tool-schema"

const ADAPTER = "gemini"

// =============================================================================
// Public Model Input
// =============================================================================
export type GeminiModelInput = AdapterModelInput

// =============================================================================
// Request Payload Schema
// =============================================================================
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
  parameters: Schema.optional(JsonObject),
})

const GeminiTool = Schema.Struct({
  functionDeclarations: Schema.Array(GeminiFunctionDeclaration),
})

const GeminiToolConfig = Schema.Struct({
  functionCallingConfig: Schema.Struct({
    mode: Schema.Literals(["AUTO", "NONE", "ANY"]),
    allowedFunctionNames: optionalArray(Schema.String),
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
  topK: Schema.optional(Schema.Number),
  stopSequences: optionalArray(Schema.String),
  thinkingConfig: Schema.optional(GeminiThinkingConfig),
})

const GeminiPayloadFields = {
  contents: Schema.Array(GeminiContent),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: optionalArray(GeminiTool),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
}
const GeminiPayload = Schema.Struct(GeminiPayloadFields)
export type GeminiPayload = Schema.Schema.Type<typeof GeminiPayload>

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
  candidates: optionalArray(GeminiCandidate),
  usageMetadata: Schema.optional(GeminiUsage),
})
type GeminiChunk = Schema.Schema.Type<typeof GeminiChunk>

interface ParserState {
  readonly finishReason?: string
  readonly hasToolCalls: boolean
  readonly nextToolCallId: number
  readonly usage?: Usage
}

const invalid = ProviderShared.invalidRequest

const mediaData = ProviderShared.mediaBytes

// =============================================================================
// Tool Schema Conversion
// =============================================================================
// Tool-schema conversion has two distinct concerns:
//
// 1. Sanitize — fix common authoring mistakes Gemini rejects: integer/number
//    enums (must be strings), `required` entries that don't match a property,
//    untyped arrays (`items` must be present), and `properties`/`required`
//    keys on non-object scalars. Mirrors OpenCode's historical Gemini rules.
//
// 2. Project — lossy mapping from JSON Schema to Gemini's schema dialect:
//    drop empty objects, derive `nullable: true` from `type: [..., "null"]`,
//    coerce `const` to `[const]` enum, recurse properties/items, propagate
//    only an allowlisted set of keys (description, required, format, type,
//    properties, items, allOf, anyOf, oneOf, minLength). Anything outside the
//    allowlist (e.g. `additionalProperties`, `$ref`) is silently dropped.
//
// Sanitize runs first, then project. The implementation lives in
// `utils/gemini-tool-schema` so this protocol keeps the same shape as the other
// provider protocols.

// =============================================================================
// Request Lowering
// =============================================================================
const lowerTool = (tool: ToolDefinition) => ({
  name: tool.name,
  description: tool.description,
  parameters: GeminiToolSchema.convert(tool.inputSchema),
})

const lowerToolConfig = Effect.fn("Gemini.lowerToolConfig")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type === "required") return { functionCallingConfig: { mode: "ANY" as const } }
  if (toolChoice.type === "none") return { functionCallingConfig: { mode: "NONE" as const } }
  if (toolChoice.type !== "tool") return { functionCallingConfig: { mode: "AUTO" as const } }
  if (!toolChoice.name) return yield* invalid("Gemini tool choice requires a tool name")
  return {
    functionCallingConfig: { mode: "ANY" as const, allowedFunctionNames: [toolChoice.name] },
  }
})

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
            content: ProviderShared.toolResultText(part),
          },
        },
      })
    }
    contents.push({ role: "user", parts })
  }

  return contents
})

const geminiOptions = (request: LLMRequest) => request.providerOptions?.gemini

const thinkingConfig = (request: LLMRequest) => {
  const value = geminiOptions(request)?.thinkingConfig
  if (!ProviderShared.isRecord(value)) return undefined
  const result = {
    thinkingBudget: typeof value.thinkingBudget === "number" ? value.thinkingBudget : undefined,
    includeThoughts: typeof value.includeThoughts === "boolean" ? value.includeThoughts : undefined,
  }
  return Object.values(result).some((item) => item !== undefined) ? result : undefined
}

const toPayload = Effect.fn("Gemini.toPayload")(function* (request: LLMRequest) {
  const toolsEnabled = request.tools.length > 0 && request.toolChoice?.type !== "none"
  const generationConfig = {
    maxOutputTokens: request.generation.maxTokens,
    temperature: request.generation.temperature,
    topP: request.generation.topP,
    topK: request.generation.topK,
    stopSequences: request.generation.stop,
    thinkingConfig: thinkingConfig(request),
  }

  return {
    contents: yield* lowerMessages(request),
    systemInstruction: request.system.length === 0 ? undefined : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: toolsEnabled ? [{ functionDeclarations: request.tools.map(lowerTool) }] : undefined,
    toolConfig: toolsEnabled && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined) ? generationConfig : undefined,
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
const mapUsage = (usage: GeminiUsage | undefined) => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    reasoningTokens: usage.thoughtsTokenCount,
    cacheReadInputTokens: usage.cachedContentTokenCount,
    totalTokens: ProviderShared.totalTokens(usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount),
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
  if (!candidate?.content) return Effect.succeed([{ ...nextState, finishReason: candidate?.finishReason ?? nextState.finishReason }, []] as const)

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

// =============================================================================
// Protocol And Gemini Adapter
// =============================================================================
/**
 * The Gemini protocol — request lowering, payload schema, and the streaming-
 * chunk state machine. Used by Google AI Studio Gemini and
 * (once registered) Vertex Gemini.
 */
export const protocol = Protocol.define({
  id: ADAPTER,
  payload: GeminiPayload,
  toPayload,
  chunk: Protocol.jsonChunk(GeminiChunk),
  initial: () => ({ hasToolCalls: false, nextToolCallId: 0 }),
  process: processChunk,
  onHalt: finish,
})

export const adapter = Adapter.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.baseURL({
    default: "https://generativelanguage.googleapis.com/v1beta",
    // Gemini's path embeds the model id and pins SSE framing at the URL level.
    path: ({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`,
  }),
  auth: Auth.apiKeyHeader("x-goog-api-key"),
  framing: Framing.sse,
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = Adapter.model(adapter, {
  provider: "google",
  capabilities: capabilities({
    input: { image: true, audio: true, video: true, pdf: true },
    output: { reasoning: true },
    tools: { calls: true },
    reasoning: { efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
  }),
})

export * as Gemini from "./gemini"
