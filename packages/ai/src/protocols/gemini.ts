import { Effect, Option, Schema } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import {
  AIError,
  LLMEvent,
  Usage,
  type FinishReason,
  type LLMRequest,
  type MediaPart,
  type ProviderMetadata,
  type ProviderOptions,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema/index.js"
import { classifyProviderFailure } from "../provider-error.js"
import { Media } from "../media.js"
import { JsonObject, knownString, lenient, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { GeminiJsonSchema } from "./utils/gemini-json-schema.js"
import { Lifecycle } from "./utils/lifecycle.js"

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

/** Caller-facing provider options; unknown keys are accepted and ignored. */
export type OptionsInput = ProviderOptions & typeof Options.Encoded
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
  thoughtSignature: optionalNull(Schema.String),
})
type GeminiInlineDataPart = Schema.Schema.Type<typeof GeminiInlineDataPart>

/** Gemini Files API reference; the only remote input Gemini accepts. */
const GeminiFileDataPart = Schema.Struct({
  fileData: Schema.Struct({
    mimeType: Schema.String,
    fileUri: Schema.String,
  }),
})

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
  GeminiFileDataPart,
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
  parametersJsonSchema: JsonObject,
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

const GeminiThinkingLevel = knownString<"minimal" | "low" | "medium" | "high">()
const GeminiThinkingConfig = Schema.Struct({
  thinkingBudget: Schema.optional(Schema.Number),
  includeThoughts: Schema.optional(Schema.Boolean),
  thinkingLevel: Schema.optional(GeminiThinkingLevel),
})

const GeminiSafetySetting = Schema.Struct({
  category: knownString<
    | "HARM_CATEGORY_UNSPECIFIED"
    | "HARM_CATEGORY_HATE_SPEECH"
    | "HARM_CATEGORY_DANGEROUS_CONTENT"
    | "HARM_CATEGORY_HARASSMENT"
    | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
    | "HARM_CATEGORY_CIVIC_INTEGRITY"
  >(),
  threshold: knownString<
    | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
    | "BLOCK_LOW_AND_ABOVE"
    | "BLOCK_MEDIUM_AND_ABOVE"
    | "BLOCK_ONLY_HIGH"
    | "BLOCK_NONE"
    | "OFF"
  >(),
})

// =============================================================================
// Provider Options
// =============================================================================
// Malformed fields are dropped rather than failing the request; a `thinkingConfig`
// object that omits `includeThoughts` asks for thoughts.
const GeminiThinkingConfigInput = Schema.Struct({
  thinkingBudget: lenient(Schema.Number),
  includeThoughts: lenient(Schema.Boolean),
  thinkingLevel: lenient(GeminiThinkingLevel),
})
const Options = Schema.Struct({
  cachedContent: lenient(Schema.String),
  safetySettings: lenient(Schema.Array(GeminiSafetySetting)),
  serviceTier: lenient(knownString<"standard" | "flex" | "priority">()),
  thinkingConfig: lenient(GeminiThinkingConfigInput),
})
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))

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
  error: Schema.optional(Schema.Unknown),
  candidates: optionalNull(Schema.Array(GeminiCandidate)),
  promptFeedback: optionalNull(GeminiPromptFeedback),
  usageMetadata: optionalNull(GeminiUsage),
})
type GeminiEvent = Schema.Schema.Type<typeof GeminiEvent>

interface ParserState {
  readonly route: string
  readonly providerMetadataKey: string
  readonly finishReason?: string
  readonly hasToolCalls: boolean
  readonly promptFeedback?: GeminiPromptFeedback
  readonly usage?: Usage
  readonly lifecycle: Lifecycle.State
  readonly reasoningSignature?: string
  readonly textSignature?: string
  readonly reasoningId?: string
  readonly textId?: string
  readonly nextReasoningId: number
  readonly nextTextId: number
  readonly seenCallIds?: ReadonlySet<string>
}

// =============================================================================
// Request Lowering
// =============================================================================
// Tool schemas go in `parametersJsonSchema`, which accepts standard JSON Schema.
// `utils/gemini-json-schema` rewrites only the few shapes Gemini still rejects. This
// protocol always applies it, including for tuned endpoints whose IDs do not name Gemini.
const lowerTool = (tool: ToolDefinition) => ({
  name: tool.name,
  description: tool.description,
  parametersJsonSchema: GeminiJsonSchema.normalize(tool.inputSchema),
})

const lowerToolConfig = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("Gemini", toolChoice, {
    auto: () => ({ functionCallingConfig: { mode: "AUTO" as const } }),
    none: () => ({ functionCallingConfig: { mode: "NONE" as const } }),
    required: () => ({ functionCallingConfig: { mode: "ANY" as const } }),
    tool: (name) => ({ functionCallingConfig: { mode: "ANY" as const, allowedFunctionNames: [name] } }),
  })

const lowerContentPart = Effect.fn("Gemini.lowerContentPart")(function* (part: TextPart | MediaPart) {
  if (part.type === "text") return { text: part.text }
  return yield* GeminiGenerateContent.mediaPart("Gemini", part.media)
})

const providerMetadata = (key: string, metadata: Record<string, unknown>): ProviderMetadata => ({ [key]: metadata })

const thoughtSignature = (metadata: ProviderMetadata | undefined, key: string) => {
  const value = metadata?.[key]
  return ProviderShared.isRecord(value) && typeof value.thoughtSignature === "string"
    ? value.thoughtSignature
    : undefined
}

const lowerToolCall = (part: ToolCallPart, omitIds: boolean, metadataKey: string) => ({
  functionCall: { ...(omitIds ? {} : { id: part.id }), name: part.name, args: part.input },
  thoughtSignature: thoughtSignature(part.providerMetadata, metadataKey),
})

const lowerMessages = Effect.fn("Gemini.lowerMessages")(function* (request: LLMRequest) {
  const contents: GeminiContent[] = []
  const metadataKey = request.model.route.providerMetadataKey ?? String(request.model.provider)
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
        parts.push(yield* lowerContentPart(part))
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      // Parallel Gemini 3 calls may carry one signature on the first call; unsigned sibling calls are valid.
      let hasSignedToolCall = false
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call", "media"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "assistant", [
            "text",
            "reasoning",
            "tool-call",
            "media",
          ])
        if (part.type === "text") {
          parts.push({ text: part.text, thoughtSignature: thoughtSignature(part.providerMetadata, metadataKey) })
          continue
        }
        // Generated images replay as model-role inline data so multi-turn image editing keeps the prior output.
        if (part.type === "media") {
          const lowered = yield* lowerContentPart(part)
          parts.push({ ...lowered, thoughtSignature: thoughtSignature(part.providerMetadata, metadataKey) })
          continue
        }
        if (part.type === "reasoning") {
          parts.push({
            text: part.text,
            thought: true,
            thoughtSignature: thoughtSignature(part.providerMetadata, metadataKey),
          })
          continue
        }
        if (part.type === "tool-call") {
          const lowered = lowerToolCall(part, omitCallIds, metadataKey)
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
        const value = yield* ProviderShared.requireInlineMedia("Gemini", ProviderShared.toolFileMedia(item).media)
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

const fromRequest = Effect.fn("Gemini.fromRequest")(function* (request: LLMRequest) {
  const flattened = ProviderShared.flattenToolRequest(request)
  const hasTools = flattened.tools.length > 0
  const generation = request.generation
  const options = yield* decodeOptions(request.providerOptions ?? {})
  const generationConfig = {
    maxOutputTokens: generation?.maxTokens,
    temperature: generation?.temperature,
    topP: generation?.topP,
    topK: generation?.topK,
    frequencyPenalty: generation?.frequencyPenalty,
    presencePenalty: generation?.presencePenalty,
    seed: generation?.seed,
    stopSequences: generation?.stop,
    thinkingConfig:
      options.thinkingConfig === undefined
        ? undefined
        : { ...options.thinkingConfig, includeThoughts: options.thinkingConfig.includeThoughts ?? true },
  }

  return {
    cachedContent: options.cachedContent,
    contents: yield* lowerMessages(flattened.request),
    safetySettings: options.safetySettings,
    serviceTier: options.serviceTier,
    systemInstruction:
      request.system.length === 0 ? undefined : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: hasTools
      ? [
          {
            functionDeclarations: flattened.tools.map(lowerTool),
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
const mapUsage = (usage: GeminiUsage | undefined, metadataKey: string) => {
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
    providerMetadata: providerMetadata(metadataKey, usage),
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
  if (state.reasoningId !== undefined)
    lifecycle = Lifecycle.reasoningEnd(
      lifecycle,
      events,
      state.reasoningId,
      state.reasoningSignature === undefined
        ? undefined
        : providerMetadata(state.providerMetadataKey, { thoughtSignature: state.reasoningSignature }),
    )
  if (state.textId !== undefined)
    lifecycle = Lifecycle.textEnd(
      lifecycle,
      events,
      state.textId,
      state.textSignature === undefined
        ? undefined
        : providerMetadata(state.providerMetadataKey, { thoughtSignature: state.textSignature }),
    )
  Lifecycle.finish(lifecycle, events, {
    reason: {
      normalized:
        promptBlockReason === undefined ? mapFinishReason(finishReason, state.hasToolCalls) : "content-filter",
      raw: finishReason,
    },
    usage: state.usage,
    providerMetadata:
      state.promptFeedback === undefined
        ? undefined
        : providerMetadata(state.providerMetadataKey, { promptFeedback: state.promptFeedback }),
  })
  return events
}

const step = (state: ParserState, event: GeminiEvent) => {
  if (ProviderShared.isRecord(event.error)) {
    const body = ProviderShared.encodeJson(event)
    return Effect.fail(
      new AIError({
        reason: classifyProviderFailure({
          message:
            typeof event.error.message === "string" && event.error.message.length > 0
              ? event.error.message
              : typeof event.error.status === "string" && event.error.status.length > 0
                ? event.error.status
                : "Gemini provider error",
          status: typeof event.error.code === "number" ? event.error.code : undefined,
          rawBody: body,
        }),
      }),
    )
  }
  if ("error" in event)
    return Effect.fail(
      ProviderShared.eventError(state.route, `Invalid ${state.route} stream event`, ProviderShared.encodeJson(event)),
    )
  const nextState = {
    ...state,
    promptFeedback: event.promptFeedback ?? state.promptFeedback,
    usage: event.usageMetadata
      ? (mapUsage(event.usageMetadata, state.providerMetadataKey) ?? state.usage)
      : state.usage,
  }
  const candidate = event.candidates?.[0]
  if (candidate?.finishReason && mapFinishReason(candidate.finishReason, state.hasToolCalls) === "error")
    return Effect.fail(
      ProviderShared.eventError(
        state.route,
        `Gemini stopped with ${candidate.finishReason}`,
        ProviderShared.encodeJson(event),
      ),
    )
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
  let reasoningId = nextState.reasoningId
  let textId = nextState.textId
  let nextReasoningId = nextState.nextReasoningId
  let nextTextId = nextState.nextTextId
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
    // Image-capable Gemini models return generated images as inline data parts; surface them as first-class output.
    if ("inlineData" in part) {
      lifecycle = Lifecycle.stepStart(lifecycle, events)
      events.push(
        LLMEvent.media({
          media: Media.base64(part.inlineData.data, part.inlineData.mimeType),
          providerMetadata: signature
            ? providerMetadata(state.providerMetadataKey, { thoughtSignature: signature })
            : undefined,
        }),
      )
      continue
    }
    if ("text" in part && part.text.length > 0) {
      if (part.thought) {
        if (textId !== undefined) {
          lifecycle = Lifecycle.textEnd(
            lifecycle,
            events,
            textId,
            textSignature
              ? providerMetadata(state.providerMetadataKey, { thoughtSignature: textSignature })
              : undefined,
          )
          textId = undefined
          textSignature = undefined
        }
        if (reasoningId === undefined) {
          reasoningId = `reasoning-${nextReasoningId}`
          nextReasoningId += 1
        }
        lifecycle = Lifecycle.reasoningDelta(
          lifecycle,
          events,
          reasoningId,
          part.text,
          signature ? providerMetadata(state.providerMetadataKey, { thoughtSignature: signature }) : undefined,
        )
        continue
      }
      if (reasoningId !== undefined) {
        lifecycle = Lifecycle.reasoningEnd(
          lifecycle,
          events,
          reasoningId,
          reasoningSignature
            ? providerMetadata(state.providerMetadataKey, { thoughtSignature: reasoningSignature })
            : undefined,
        )
        reasoningId = undefined
        reasoningSignature = undefined
      }
      if (textId === undefined) {
        textId = `text-${nextTextId}`
        nextTextId += 1
      }
      lifecycle = Lifecycle.textDelta(
        lifecycle,
        events,
        textId,
        part.text,
        textSignature ? providerMetadata(state.providerMetadataKey, { thoughtSignature: textSignature }) : undefined,
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
      if (reasoningId !== undefined) {
        lifecycle = Lifecycle.reasoningEnd(
          lifecycle,
          events,
          reasoningId,
          reasoningSignature
            ? providerMetadata(state.providerMetadataKey, { thoughtSignature: reasoningSignature })
            : undefined,
        )
        reasoningId = undefined
        reasoningSignature = undefined
      }
      if (textId !== undefined) {
        lifecycle = Lifecycle.textEnd(
          lifecycle,
          events,
          textId,
          textSignature ? providerMetadata(state.providerMetadataKey, { thoughtSignature: textSignature }) : undefined,
        )
        textId = undefined
        textSignature = undefined
      }
      lifecycle = Lifecycle.stepStart(lifecycle, events)
      events.push(
        LLMEvent.toolCall({
          id,
          name: part.functionCall.name,
          input,
          providerMetadata: part.thoughtSignature
            ? providerMetadata(state.providerMetadataKey, { thoughtSignature: part.thoughtSignature })
            : undefined,
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
      reasoningId,
      textId,
      nextReasoningId,
      nextTextId,
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
      providerMetadataKey: request.model.route.providerMetadataKey ?? String(request.model.provider),
      hasToolCalls: false,
      lifecycle: Lifecycle.initial(),
      nextReasoningId: 0,
      nextTextId: 0,
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
