import { Effect, Option, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import {
  LLMEvent,
  Usage,
  type FinishReason,
  type JsonSchema,
  type LLMRequest,
  type MediaPart,
  type ProviderMetadata,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema/index.js"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { GeminiToolSchema } from "./utils/gemini-tool-schema.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"

const ADAPTER = "gemini"
// Google documents this sentinel for replaying Gemini 3 function calls after their original signature was lost.
const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

// Gemini 3 rejects replayed function calls without a thought signature. Google's SDKs avoid that in normal chats by
// retaining complete model responses, but OpenCode reconstructs durable history and may encounter an unsigned call
// from an older or external session. Model IDs are open-ended, so unknown Gemini aliases inherit current behavior.
const requiresThoughtSignatureFallback = (modelID: string) => {
  if (!/(^|\/)gemini-/i.test(modelID)) return false
  if (/(^|\/)gemini-(?:1|2)(?:[.-]|$)/i.test(modelID)) return false
  if (/(^|\/)gemini-pro(?:-vision)?$/i.test(modelID)) return false
  return !/(^|\/)gemini-robotics-er-1\.5(?:[.-]|$)/i.test(modelID)
}

// Gemini 3 accepts media nested inside function responses; matched Gemini 2.5 variants reject it,
// so their tool-result attachments lower as a separate user turn instead.
const routesLegacyToolMedia = (modelID: string) => /gemini-2[.-]5(?:[.-]|$)/i.test(modelID)

// Blacklist: Gemini 1.x/2.x ignore or reject explicit function call ids.
// Every other model id (Gemini 3+, gemma, anything unrecognized) gets them.
const omitsFunctionCallIds = (modelID: string) => {
  const match = /^gemini(?:-live)?-(\d+)/i.exec(modelID)
  return match !== null && Number(match[1]) < 3
}

export interface OptionsInput {
  readonly [key: string]: unknown
  readonly cachedContent?: string
  readonly safetySettings?: ReadonlyArray<{
    readonly category:
      | "HARM_CATEGORY_UNSPECIFIED"
      | "HARM_CATEGORY_HATE_SPEECH"
      | "HARM_CATEGORY_DANGEROUS_CONTENT"
      | "HARM_CATEGORY_HARASSMENT"
      | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
      | "HARM_CATEGORY_CIVIC_INTEGRITY"
      | (string & {})
    readonly threshold:
      | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
      | "BLOCK_LOW_AND_ABOVE"
      | "BLOCK_MEDIUM_AND_ABOVE"
      | "BLOCK_ONLY_HIGH"
      | "BLOCK_NONE"
      | "OFF"
      | (string & {})
  }>
  readonly serviceTier?: "standard" | "flex" | "priority" | (string & {})
  readonly thinkingConfig?: {
    readonly thinkingBudget?: number
    readonly includeThoughts?: boolean
    readonly thinkingLevel?: "minimal" | "low" | "medium" | "high" | (string & {})
  }
}

export type ProviderOptionsInput = OptionsInput

// =============================================================================
// Request Body Schema
// =============================================================================
// Gemini is known to send explicit `null` for optional streaming fields
// (usage counts, flags, whole subtrees), so every response-side optional uses
// `optionalNull` instead of bare `Schema.optional`. The same part/content
// schemas lower the outbound request body; encoding drops `undefined` keys,
// so the shared schemas stay safe there.
const GeminiTextPart = Schema.Struct({
  text: Schema.String,
  thought: optionalNull(Schema.Boolean),
  thoughtSignature: optionalNull(Schema.String),
})

const GeminiInlineDataPart = Schema.Struct({
  inlineData: Schema.Struct({
    mimeType: Schema.String,
    data: Schema.String,
  }),
})
type GeminiInlineDataPart = Schema.Schema.Type<typeof GeminiInlineDataPart>

const GeminiFunctionCallPart = Schema.Struct({
  functionCall: Schema.Struct({
    id: optionalNull(Schema.String),
    name: Schema.String,
    args: Schema.optional(Schema.Unknown),
  }),
  thoughtSignature: optionalNull(Schema.String),
})

const GeminiFunctionResponsePart = Schema.Struct({
  functionResponse: Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.String,
    response: Schema.Unknown,
    parts: Schema.optional(Schema.Array(GeminiInlineDataPart)),
  }),
})

const GeminiContentPart = Schema.Union([
  GeminiTextPart,
  GeminiInlineDataPart,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
])
const decodeGeminiContentPart = Schema.decodeUnknownOption(GeminiContentPart)

const GeminiContent = Schema.Struct({
  role: optionalNull(Schema.Literals(["user", "model"])),
  parts: optionalNull(Schema.Array(GeminiContentPart)),
})
type GeminiContent = Schema.Schema.Type<typeof GeminiContent>

const GeminiResponseContent = Schema.Struct({
  role: optionalNull(Schema.Literals(["user", "model"])),
  parts: optionalNull(Schema.Array(Schema.Unknown)),
})

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
  thinkingLevel: Schema.optional(Schema.String),
})

const GeminiSafetySetting = Schema.Struct({
  category: Schema.String,
  threshold: Schema.String,
})

const GeminiGenerationConfig = Schema.Struct({
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stopSequences: optionalArray(Schema.String),
  thinkingConfig: Schema.optional(GeminiThinkingConfig),
})

const GeminiBodyFields = {
  cachedContent: Schema.optional(Schema.String),
  contents: Schema.Array(GeminiContent),
  labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  safetySettings: optionalArray(GeminiSafetySetting),
  serviceTier: Schema.optional(Schema.String),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: optionalArray(GeminiTool),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
}
const GeminiBody = Schema.Struct(GeminiBodyFields)
export type GeminiBody = Schema.Schema.Type<typeof GeminiBody>

const GeminiUsage = Schema.Struct({
  cachedContentTokenCount: optionalNull(Schema.Number),
  thoughtsTokenCount: optionalNull(Schema.Number),
  promptTokenCount: optionalNull(Schema.Number),
  candidatesTokenCount: optionalNull(Schema.Number),
  totalTokenCount: optionalNull(Schema.Number),
})
type GeminiUsage = Schema.Schema.Type<typeof GeminiUsage>

const GeminiCandidate = Schema.Struct({
  content: optionalNull(GeminiResponseContent),
  finishReason: optionalNull(Schema.String),
})

const GeminiPromptFeedback = Schema.StructWithRest(
  Schema.Struct({
    blockReason: optionalNull(Schema.String),
    blockReasonMessage: optionalNull(Schema.String),
    safetyRatings: optionalNull(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type GeminiPromptFeedback = Schema.Schema.Type<typeof GeminiPromptFeedback>

const GeminiEvent = Schema.Struct({
  candidates: optionalNull(Schema.Array(GeminiCandidate)),
  promptFeedback: optionalNull(GeminiPromptFeedback),
  usageMetadata: optionalNull(GeminiUsage),
})
type GeminiEvent = Schema.Schema.Type<typeof GeminiEvent>

interface ParserState {
  readonly route: string
  readonly finishReason?: string
  readonly hasToolCalls: boolean
  readonly promptFeedback?: GeminiPromptFeedback
  readonly usage?: Usage
  readonly lifecycle: Lifecycle.State
  readonly reasoningSignature?: string
  readonly textSignature?: string
  readonly seenCallIds?: ReadonlySet<string>
}

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
//    drop empty root parameter schemas while preserving nested empty objects,
//    expand type arrays into `anyOf`, derive `nullable: true` from null members,
//    coerce `const` to `[const]` enum, recurse properties/items, and propagate
//    only an allowlisted set of keys (description, required, format, type,
//    nullable, enum, properties, items, allOf, anyOf, oneOf, minLength).
//    Anything outside the allowlist (e.g. `additionalProperties`, `$ref`) is
//    silently dropped.
//
// Sanitize runs first, then project. The implementation lives in
// `utils/gemini-tool-schema` so this protocol keeps the same shape as the other
// provider protocols.

// =============================================================================
// Request Lowering
// =============================================================================
const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema) => ({
  name: tool.name,
  description: tool.description,
  parameters: GeminiToolSchema.convert(inputSchema),
})

const lowerToolConfig = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("Gemini", toolChoice, {
    auto: () => ({ functionCallingConfig: { mode: "AUTO" as const } }),
    none: () => ({ functionCallingConfig: { mode: "NONE" as const } }),
    required: () => ({ functionCallingConfig: { mode: "ANY" as const } }),
    tool: (name) => ({ functionCallingConfig: { mode: "ANY" as const, allowedFunctionNames: [name] } }),
  })

const lowerUserPart = Effect.fn("Gemini.lowerUserPart")(function* (part: TextPart | MediaPart) {
  if (part.type === "text") return { text: part.text }
  const media = ProviderShared.normalizeMedia(part)
  return { inlineData: { mimeType: media.mime, data: media.base64 } }
})

const googleMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ google: metadata })

const thoughtSignature = (providerMetadata: ProviderMetadata | undefined) => {
  const google = providerMetadata?.google
  return ProviderShared.isRecord(google) && typeof google.thoughtSignature === "string"
    ? google.thoughtSignature
    : undefined
}

const lowerToolCall = (part: ToolCallPart, omitIds: boolean) => ({
  functionCall: { ...(omitIds ? {} : { id: part.id }), name: part.name, args: part.input },
  thoughtSignature: thoughtSignature(part.providerMetadata),
})

const lowerMessages = Effect.fn("Gemini.lowerMessages")(function* (request: LLMRequest) {
  const contents: GeminiContent[] = []
  const omitCallIds = omitsFunctionCallIds(request.model.id)
  const legacyToolMedia = routesLegacyToolMedia(request.model.id)
  let pendingMedia: GeminiInlineDataPart[] | undefined
  const flushMedia = () => {
    if (!pendingMedia) return
    contents.push({ role: "user", parts: [{ text: "Attached media from tool result:" }, ...pendingMedia] })
    pendingMedia = undefined
  }

  for (const message of request.messages) {
    if (message.role !== "tool") flushMedia()
    if (message.role === "system") {
      const part = yield* ProviderShared.wrappedSystemUpdate("Gemini", message)
      const previous = contents.at(-1)
      // Gemini rejects a continuation whose function-response turn carries extra
      // parts, so an update after a tool result starts its own user turn.
      if (previous?.role === "user" && !(previous.parts ?? []).some((item) => "functionResponse" in item))
        contents[contents.length - 1] = { role: "user", parts: [...(previous.parts ?? []), { text: part.text }] }
      else contents.push({ role: "user", parts: [{ text: part.text }] })
      continue
    }

    if (message.role === "user") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "media"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "user", ["text", "media"])
        parts.push(yield* lowerUserPart(part))
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      // Parallel Gemini 3 calls may carry one signature on the first call; unsigned sibling calls are valid.
      let hasSignedToolCall = false
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "assistant", ["text", "reasoning", "tool-call"])
        if (part.type === "text") {
          parts.push({ text: part.text, thoughtSignature: thoughtSignature(part.providerMetadata) })
          continue
        }
        if (part.type === "reasoning") {
          parts.push({ text: part.text, thought: true, thoughtSignature: thoughtSignature(part.providerMetadata) })
          continue
        }
        if (part.type === "tool-call") {
          const lowered = lowerToolCall(part, omitCallIds)
          const signature = lowered.thoughtSignature
          parts.push({
            ...lowered,
            thoughtSignature:
              signature ??
              (requiresThoughtSignatureFallback(request.model.id) && !hasSignedToolCall
                ? SKIP_THOUGHT_SIGNATURE_VALIDATOR
                : undefined),
          })
          if (signature !== undefined) hasSignedToolCall = true
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
      if (part.result.type !== "content") {
        parts.push({
          functionResponse: {
            ...(omitCallIds ? {} : { id: part.id }),
            name: part.name,
            response: {
              name: part.name,
              content: ProviderShared.toolResultText(part),
            },
          },
        })
        continue
      }
      const content: ReadonlyArray<Tool.Content> = part.result.value
      const text = content.filter((item) => item.type === "text").map((item) => item.text)
      const media: GeminiInlineDataPart[] = []
      for (const item of content) {
        if (item.type === "text") continue
        const value = ProviderShared.normalizeToolFile(item)
        media.push({ inlineData: { mimeType: value.mime, data: value.base64 } })
      }
      if (legacyToolMedia && media.length > 0) (pendingMedia ??= []).push(...media)
      parts.push({
        functionResponse: {
          ...(omitCallIds ? {} : { id: part.id }),
          name: part.name,
          response: {
            name: part.name,
            content: text.join("\n"),
          },
          parts: legacyToolMedia || media.length === 0 ? undefined : media,
        },
      })
    }
    // Gemini requires every response to a parallel call batch in one user turn,
    // so consecutive tool results join the open function-response turn.
    const previous = contents.at(-1)
    if (previous?.role === "user" && (previous.parts ?? []).some((item) => "functionResponse" in item))
      contents[contents.length - 1] = { role: "user", parts: [...(previous.parts ?? []), ...parts] }
    else contents.push({ role: "user", parts })
  }

  flushMedia()
  return contents
})

const resolveOptions = (request: LLMRequest) => {
  const input = request.providerOptions
  const value = input?.thinkingConfig
  const thinkingConfig = {
    thinkingBudget:
      ProviderShared.isRecord(value) && typeof value.thinkingBudget === "number" ? value.thinkingBudget : undefined,
    includeThoughts:
      ProviderShared.isRecord(value) && typeof value.includeThoughts === "boolean"
        ? value.includeThoughts
        : ProviderShared.isRecord(value)
          ? true
          : undefined,
    thinkingLevel:
      ProviderShared.isRecord(value) && typeof value.thinkingLevel === "string" ? value.thinkingLevel : undefined,
  }
  return {
    cachedContent: typeof input?.cachedContent === "string" ? input.cachedContent : undefined,
    safetySettings: mapSafetySettings(input?.safetySettings),
    serviceTier: typeof input?.serviceTier === "string" ? input.serviceTier : undefined,
    thinkingConfig: Object.values(thinkingConfig).some((item) => item !== undefined) ? thinkingConfig : undefined,
  }
}

function mapSafetySettings(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const settings = value.flatMap((item) =>
    ProviderShared.isRecord(item) && typeof item.category === "string" && typeof item.threshold === "string"
      ? [{ category: item.category, threshold: item.threshold }]
      : [],
  )
  return settings
}

const fromRequest = Effect.fn("Gemini.fromRequest")(function* (request: LLMRequest) {
  const hasTools = request.tools.length > 0
  const generation = request.generation
  const options = resolveOptions(request)
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema
  const generationConfig = {
    maxOutputTokens: generation?.maxTokens,
    temperature: generation?.temperature,
    topP: generation?.topP,
    topK: generation?.topK,
    frequencyPenalty: generation?.frequencyPenalty,
    presencePenalty: generation?.presencePenalty,
    seed: generation?.seed,
    stopSequences: generation?.stop,
    thinkingConfig: options.thinkingConfig,
  }

  return {
    cachedContent: options.cachedContent,
    contents: yield* lowerMessages(request),
    safetySettings: options.safetySettings,
    serviceTier: options.serviceTier,
    systemInstruction:
      request.system.length === 0 ? undefined : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: hasTools
      ? [
          {
            functionDeclarations: request.tools.map((tool) =>
              lowerTool(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility)),
            ),
          },
        ]
      : undefined,
    toolConfig: hasTools && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined)
      ? generationConfig
      : undefined,
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
// Gemini reports `promptTokenCount` (inclusive total) with a
// `cachedContentTokenCount` subset. `candidatesTokenCount` is *exclusive*
// of `thoughtsTokenCount` — visible-only, not a total — so we sum the two
// to produce the inclusive `outputTokens` the rest of the contract expects.
const mapUsage = (usage: GeminiUsage | undefined) => {
  if (!usage) return undefined
  // Explicit provider nulls decode as `null`; normalize to `undefined` so the
  // token arithmetic below treats them like absent counts.
  const promptTokens = usage.promptTokenCount ?? undefined
  const cached = usage.cachedContentTokenCount ?? undefined
  const thoughts = usage.thoughtsTokenCount ?? undefined
  const visible = usage.candidatesTokenCount ?? undefined
  const nonCached = ProviderShared.subtractTokens(promptTokens, cached)
  // `candidatesTokenCount` is visible-only; sum with thoughts to produce the
  // inclusive `outputTokens` the contract expects. Only compute the total
  // when the visible component is reported — otherwise we'd fabricate an
  // inclusive number from a partial breakdown.
  const outputTokens = visible !== undefined ? visible + (thoughts ?? 0) : undefined
  return new Usage({
    inputTokens: promptTokens,
    outputTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: thoughts,
    totalTokens: ProviderShared.totalTokens(promptTokens, outputTokens, usage.totalTokenCount ?? undefined),
    providerMetadata: { google: usage },
  })
}

const mapFinishReason = (finishReason: string | undefined, hasToolCalls: boolean): FinishReason => {
  if (finishReason === undefined) return hasToolCalls ? "tool-calls" : "unknown"
  if (finishReason === "STOP") return hasToolCalls ? "tool-calls" : "stop"
  if (finishReason === "MAX_TOKENS") return "length"
  if (
    finishReason === "IMAGE_SAFETY" ||
    finishReason === "RECITATION" ||
    finishReason === "SAFETY" ||
    finishReason === "BLOCKLIST" ||
    finishReason === "PROHIBITED_CONTENT" ||
    finishReason === "SPII" ||
    finishReason === "MODEL_ARMOR" ||
    finishReason === "IMAGE_PROHIBITED_CONTENT" ||
    finishReason === "IMAGE_RECITATION" ||
    finishReason === "LANGUAGE"
  )
    return "content-filter"
  if (
    finishReason === "MALFORMED_FUNCTION_CALL" ||
    finishReason === "UNEXPECTED_TOOL_CALL" ||
    finishReason === "NO_IMAGE" ||
    finishReason === "TOO_MANY_TOOL_CALLS" ||
    finishReason === "MISSING_THOUGHT_SIGNATURE" ||
    finishReason === "MALFORMED_RESPONSE"
  )
    return "error"
  return "unknown"
}

const finish = (state: ParserState): ReadonlyArray<LLMEvent> => {
  // `?? undefined` normalizes an explicit `null` blockReason back to absent so
  // the "nothing to finish" check below keeps its meaning.
  const promptBlockReason =
    state.finishReason === undefined ? (state.promptFeedback?.blockReason ?? undefined) : undefined
  const finishReason = state.finishReason ?? promptBlockReason
  if (finishReason === undefined && state.usage === undefined) return []

  const events: LLMEvent[] = []
  let lifecycle = state.lifecycle
  if (state.reasoningSignature !== undefined)
    lifecycle = Lifecycle.reasoningEnd(
      lifecycle,
      events,
      "reasoning-0",
      googleMetadata({ thoughtSignature: state.reasoningSignature }),
    )
  if (state.textSignature !== undefined)
    lifecycle = Lifecycle.textEnd(lifecycle, events, "text-0", googleMetadata({ thoughtSignature: state.textSignature }))
  Lifecycle.finish(lifecycle, events, {
    reason: {
      normalized:
        promptBlockReason === undefined ? mapFinishReason(finishReason, state.hasToolCalls) : "content-filter",
      raw: finishReason,
    },
    usage: state.usage,
    providerMetadata:
      state.promptFeedback === undefined ? undefined : googleMetadata({ promptFeedback: state.promptFeedback }),
  })
  return events
}

const step = (state: ParserState, event: GeminiEvent) => {
  const nextState = {
    ...state,
    promptFeedback: event.promptFeedback ?? state.promptFeedback,
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
  let lifecycle = nextState.lifecycle
  let reasoningSignature = nextState.reasoningSignature
  let textSignature = nextState.textSignature
  // Supplier ids must be tracked across chunks of the same response, not just within one event's parts.
  const seenCallIds = new Set(nextState.seenCallIds)

  for (const input of candidate.content.parts ?? []) {
    if (
      ProviderShared.isRecord(input) &&
      !("text" in input) &&
      !("inlineData" in input) &&
      !("functionCall" in input) &&
      !("functionResponse" in input)
    )
      continue
    const decoded = decodeGeminiContentPart(input)
    if (Option.isNone(decoded))
      return Effect.fail(
        ProviderShared.eventError(ADAPTER, `Invalid ${state.route} stream event`, ProviderShared.encodeJson(event)),
      )
    const part = decoded.value
    const signature = "thoughtSignature" in part && part.thoughtSignature ? part.thoughtSignature : undefined
    // Gemini attaches replay signatures to thought parts, visible text, or function calls;
    // each block kind must retain the signature attached to its own parts.
    if (signature !== undefined && "thought" in part && part.thought) reasoningSignature = signature
    else if (signature !== undefined && "text" in part) textSignature = signature
    if ("text" in part && part.text.length > 0) {
      if (part.thought) {
        lifecycle = Lifecycle.reasoningDelta(
          lifecycle,
          events,
          "reasoning-0",
          part.text,
          signature ? googleMetadata({ thoughtSignature: signature }) : undefined,
        )
        continue
      }
      lifecycle = Lifecycle.reasoningEnd(
        lifecycle,
        events,
        "reasoning-0",
        reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
      )
      lifecycle = Lifecycle.textDelta(
        lifecycle,
        events,
        "text-0",
        part.text,
        textSignature ? googleMetadata({ thoughtSignature: textSignature }) : undefined,
      )
      textSignature = undefined
      continue
    }

    if ("functionCall" in part) {
      const input = part.functionCall.args === undefined ? {} : part.functionCall.args
      // Gemini 2.0+ supplies a unique function call ID on the part; when omitted (e.g. Gemini 1.5),
      // generate a globally unique ID rather than a per-request counter to prevent cross-request collisions in downstream registries.
      // A repeated supplier id would replay as two identical calls, so only the first occurrence keeps it.
      // A `null` supplier id normalizes to absent so the generated-id fallback applies.
      const supplied = part.functionCall.id ?? undefined
      const duplicate = supplied !== undefined && seenCallIds.has(supplied)
      if (supplied !== undefined) seenCallIds.add(supplied)
      const id = supplied !== undefined && !duplicate ? supplied : `tool_${crypto.randomUUID().replaceAll("-", "")}`
      lifecycle = Lifecycle.reasoningEnd(
        lifecycle,
        events,
        "reasoning-0",
        reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
      )
      lifecycle = Lifecycle.stepStart(lifecycle, events)
      events.push(
        LLMEvent.toolCall({
          id,
          name: part.functionCall.name,
          input,
          providerMetadata:
            part.thoughtSignature ? googleMetadata({ thoughtSignature: part.thoughtSignature }) : undefined,
        }),
      )
      hasToolCalls = true
    }
  }

  return Effect.succeed([
    {
      ...nextState,
      hasToolCalls,
      lifecycle,
      reasoningSignature,
      textSignature,
      seenCallIds,
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
 * streaming-event state machine shared by Google AI Studio and Vertex Gemini.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: GeminiBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(GeminiEvent),
    initial: (request) => ({
      route: `${request.model.provider}/${request.model.route.id}`,
      hasToolCalls: false,
      lifecycle: Lifecycle.initial(),
    }),
    step,
    onHalt: (state) => Effect.succeed(finish(state)),
  },
})

export const route = Route.make({
  id: ADAPTER,
  provider: "google",
  providerMetadataKey: "google",
  protocol,
  // Gemini's path embeds the model id and pins SSE framing at the URL level.
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`, {
    baseURL: DEFAULT_BASE_URL,
  }),
  auth: Auth.none,
  framing: Framing.sse,
})

export * as Gemini from "./gemini.js"
