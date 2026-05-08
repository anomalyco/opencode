import { Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
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
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

// =============================================================================
// Request Body Schema
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

const GeminiBodyFields = {
  contents: Schema.Array(GeminiContent),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: optionalArray(GeminiTool),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
}
const GeminiBody = Schema.Struct(GeminiBodyFields)
export type GeminiBody = Schema.Schema.Type<typeof GeminiBody>

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

const GeminiEvent = Schema.Struct({
  candidates: optionalArray(GeminiCandidate),
  usageMetadata: Schema.optional(GeminiUsage),
})
type GeminiEvent = Schema.Schema.Type<typeof GeminiEvent>

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

const lowerToolConfig = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("Gemini", toolChoice, {
    auto: () => ({ functionCallingConfig: { mode: "AUTO" as const } }),
    none: () => ({ functionCallingConfig: { mode: "NONE" as const } }),
    required: () => ({ functionCallingConfig: { mode: "ANY" as const } }),
    tool: (name) => ({ functionCallingConfig: { mode: "ANY" as const, allowedFunctionNames: [name] } }),
  })

const lowerUserPart = (part: TextPart | MediaPart) =>
  part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mediaType, data: mediaData(part) } }

const lowerToolCall = (part: ToolCallPart) => ({
  functionCall: { name: part.name, args: part.input },
})

const lowerMessages = Effect.fn("Gemini.lowerMessages")(function* (request: LLMRequest) {
  const contents: GeminiContent[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "media"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "user", ["text", "media"])
        parts.push(lowerUserPart(part))
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "assistant", ["text", "reasoning", "tool-call"])
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
      }
      contents.push({ role: "model", parts })
      continue
    }

    const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent("Gemini", "tool", ["tool-result"])
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

const fromRequest = Effect.fn("Gemini.fromRequest")(function* (request: LLMRequest) {
  const toolsEnabled = request.tools.length > 0 && request.toolChoice?.type !== "none"
  const generation = request.generation
  const generationConfig = {
    maxOutputTokens: generation?.maxTokens,
    temperature: generation?.temperature,
    topP: generation?.topP,
    topK: generation?.topK,
    stopSequences: generation?.stop,
    thinkingConfig: thinkingConfig(request),
  }

  return {
    contents: yield* lowerMessages(request),
    systemInstruction:
      request.system.length === 0 ? undefined : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: toolsEnabled ? [{ functionDeclarations: request.tools.map(lowerTool) }] : undefined,
    toolConfig: toolsEnabled && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined)
      ? generationConfig
      : undefined,
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

const step = (state: ParserState, event: GeminiEvent) => {
  const nextState = {
    ...state,
    usage: event.usageMetadata ? (mapUsage(event.usageMetadata) ?? state.usage) : state.usage,
  }
  const candidate = event.candidates?.[0]
  if (!candidate?.content)
    return Effect.succeed([
      { ...nextState, finishReason: candidate?.finishReason ?? nextState.finishReason },
      [],
    ] as const)

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

  return Effect.succeed([
    {
      ...nextState,
      hasToolCalls,
      nextToolCallId,
      finishReason: candidate.finishReason ?? nextState.finishReason,
    },
    events,
  ] as const)
}

// =============================================================================
// Protocol And Gemini Route
// =============================================================================
/**
 * The Gemini protocol — request body construction, body schema, and the
 * streaming-event state machine. Used by Google AI Studio Gemini and (once
 * registered) Vertex Gemini.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: GeminiBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(GeminiEvent),
    initial: () => ({ hasToolCalls: false, nextToolCallId: 0 }),
    step,
    onHalt: finish,
  },
})

export const route = Route.make({
  id: ADAPTER,
  protocol,
  // Gemini's path embeds the model id and pins SSE framing at the URL level.
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`),
  auth: Auth.apiKeyHeader("x-goog-api-key"),
  framing: Framing.sse,
})

// =============================================================================
// Model Helper
// =============================================================================
export const model = Route.model(route, {
  provider: "google",
  baseURL: DEFAULT_BASE_URL,
})

export * as Gemini from "./gemini"
