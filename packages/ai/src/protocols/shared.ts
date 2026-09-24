import { Tool } from "@opencode/schema/tool"
import { Effect, Option, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Media } from "../media.js"
import {
  InvalidProviderOutputError,
  InvalidRequestError,
  UnsupportedOperationError,
  AIError,
  LLMRequest,
  Message,
  ToolDefinition,
  type ContentPart,
  type MediaPart,
  type OpenString,
  type ProviderID,
  type TextPart,
  type ToolEntry,
  type ToolResultPart,
} from "../schema/index.js"
import { Json, decodeJson, encodeJson } from "../utils/json.js"
import { isRecord } from "../utils/record.js"
export { Json, decodeJson, encodeJson, isRecord }

const isJson = Schema.is(Schema.Json)
export const JsonObject = Schema.Record(Schema.String, Schema.Unknown)
export const optionalArray = <const S extends Schema.Top>(schema: S) => Schema.optional(Schema.Array(schema))
export const optionalNull = <const S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))
/** Optional field whose malformed value decodes to `undefined` instead of failing the enclosing struct. */
export const lenient = <const S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(
    Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined)))),
  )
/** Provider-defined string enum: known values for autocomplete, any string accepted at runtime. */
export const knownString = <Known extends string>() =>
  Schema.declare<OpenString<Known>>((value): value is OpenString<Known> => typeof value === "string", {
    expected: "string",
  })

export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64

// OpenAI limits `prompt_cache_key` to 64 chars; DeepSeek and Zai inherit the same
// limit via their OpenAI-compatible APIs. Clamp with unicode-aware slicing.
export const promptCacheKey = (request: LLMRequest): string | undefined => {
  if (request.cache === "none" || request.promptCacheKey === undefined) return undefined
  const chars = Array.from(request.promptCacheKey)
  if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return request.promptCacheKey
  return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("")
}

/**
 * Streaming tool-call accumulator. Adapters that build a tool call across
 * multiple `tool-input-delta` chunks store the partial JSON input string here
 * and finalize it with `parseToolInput` once the call completes.
 */
export interface ToolAccumulator {
  readonly id: string
  readonly name: string
  readonly namespace?: string
  readonly input: string
}

/**
 * `Usage.totalTokens` policy shared by every route. Honors a provider-
 * supplied total; otherwise falls back to `inputTokens + outputTokens` only
 * when at least one is defined. Returns `undefined` when neither input nor
 * output is known so routes don't publish a misleading `0`.
 *
 * Under the inclusive `AI.Usage` contract, `inputTokens` includes cached input
 * and `outputTokens` includes reasoning. Protocol mappers normalize those
 * inclusive values before calling this helper. The provider-supplied total is
 * the source of truth when present; otherwise their sum is the canonical total.
 */
export const totalTokens = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  total: number | undefined,
) => {
  if (total !== undefined) return total
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return (inputTokens ?? 0) + (outputTokens ?? 0)
}

/**
 * Subtract `subtrahend` from `total`, clamping to zero if the provider
 * reports a non-sensical breakdown (e.g. `cached_tokens > prompt_tokens`).
 * Used by protocol mappers when deriving a non-overlapping breakdown field
 * from a provider's inclusive total — `nonCachedInputTokens` from
 * `inputTokens - cacheReadInputTokens - cacheWriteInputTokens`.
 *
 * If `total` is `undefined`, returns `undefined` (we don't fabricate
 * counts). If `subtrahend` is `undefined`, returns `total` unchanged. The
 * provider-native breakdown stays available on `Usage.providerMetadata` for debugging.
 */
export const subtractTokens = (total: number | undefined, subtrahend: number | undefined): number | undefined => {
  if (total === undefined) return undefined
  if (subtrahend === undefined) return total
  return Math.max(0, total - subtrahend)
}

/**
 * Sum a list of optional token counts, returning `undefined` only when
 * every value is `undefined` (so we don't fabricate a `0`). Used by
 * protocol mappers to derive the inclusive `inputTokens` total from a
 * provider that natively reports a non-overlapping breakdown
 * (e.g. Anthropic, whose `input_tokens` is already non-cached only).
 */
export const sumTokens = (...values: ReadonlyArray<number | undefined>): number | undefined => {
  if (values.every((value) => value === undefined)) return undefined
  return values.reduce((acc: number, value) => acc + (value ?? 0), 0)
}

export const eventError = (route: string, message: string, body?: string, cause?: unknown) =>
  new AIError({
    reason: new InvalidProviderOutputError({ route, message, body, cause }),
  })

export const parseJson = (route: string, input: string, message: string) =>
  Effect.try({
    try: () => decodeJson(input),
    catch: (cause) => eventError(route, message, input, cause),
  })

/**
 * Join the `text` field of a list of parts with newlines. Used by routes
 * that flatten system / message content arrays into a single provider string
 * (OpenAI Chat `system` content, OpenAI Responses `system` content, Gemini
 * `systemInstruction.parts[].text`).
 */
export const joinText = (parts: ReadonlyArray<{ readonly text: string }>) => parts.map((part) => part.text).join("\n")

const escapeSystemUpdateText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/**
 * Stable fallback representation for chronological `Message.system(...)`
 * updates on routes that do not support that privileged role natively. The
 * wrapper remains visibly lower-authority user text, preserves the original
 * temporal position, and XML-escapes content so it cannot close the wrapper.
 */
export const wrapSystemUpdate = (parts: ReadonlyArray<{ readonly text: string }>) =>
  `<system-update>\n${escapeSystemUpdateText(joinText(parts))}\n</system-update>`

/**
 * Chronological system updates deliberately accept text only. Do not insert
 * raw retrieved, tool, or web content into privileged updates: keep untrusted
 * data in ordinary user/tool messages instead.
 */
export const systemUpdateText = Effect.fn("ProviderShared.systemUpdateText")(function* (
  route: string,
  message: LLMRequest["messages"][number],
) {
  const content: TextPart[] = []
  for (const part of message.content) {
    if (!supportsContent(part, ["text"])) return yield* unsupportedContent(route, "system", ["text"])
    content.push(part)
  }
  return content
})

/** Lower an unsupported privileged update into visible, in-order user text. */
export const wrappedSystemUpdate = Effect.fn("ProviderShared.wrappedSystemUpdate")(function* (
  route: string,
  message: LLMRequest["messages"][number],
) {
  const content = yield* systemUpdateText(route, message)
  return { type: "text" as const, text: wrapSystemUpdate(content), cache: content.at(-1)?.cache }
})

/**
 * Parse the streamed JSON input of a tool call. Treats an empty string as
 * `"{}"` — providers occasionally finish a tool call without ever emitting
 * input deltas (e.g. zero-arg tools). The error message is uniform across
 * routes: `Invalid JSON input for <route> tool call <name>`.
 */
export const parseToolInput = (route: string, name: string, raw: string) =>
  parseJson(route, raw || "{}", `Invalid JSON input for ${route} tool call ${name}`)

/** Inline view or a typed `InvalidRequest` for routes that cannot fetch URLs or dereference provider refs. */
export const requireInlineMedia = (route: string, asset: Media.Asset): Effect.Effect<Media.Inline, AIError> => {
  const inline = asset.inline()
  return inline ? Effect.succeed(inline) : Effect.fail(inlineRequired(route, asset))
}

export const inlineRequired = (route: string, asset: Media.Asset) =>
  invalidRequest(
    `${route} requires inline media (bytes or base64); ${asset.source.type} sources must be materialized first`,
  )

/** The remote URL of a `url` asset, for protocols that accept `http(s)` references natively. */
export const mediaUrl = (asset: Media.Asset) => (asset.source.type === "url" ? asset.source.url : undefined)

export type MediaReference = { readonly type: "dataUrl" | "url" | "ref"; readonly value: string }

/**
 * The one string a provider can address an asset by: inline payloads as a data URL, `url` sources as their URL, and
 * this provider's own `ref` as its id. Other providers' refs are never forwarded and fail typed; omit `provider` for
 * APIs with no file handles at all.
 */
export const mediaReference = (
  asset: Media.Asset,
  provider: ProviderID | undefined,
  label: string,
): Effect.Effect<MediaReference, AIError> => {
  const inline = asset.inline()
  if (inline) return Effect.succeed({ type: "dataUrl", value: inline.dataUrl })
  const url = mediaUrl(asset)
  if (url) return Effect.succeed({ type: "url", value: url })
  if (provider !== undefined && asset.source.type === "ref" && asset.source.provider === provider)
    return Effect.succeed({ type: "ref", value: asset.source.id })
  const accepted = provider === undefined ? "" : `, and ${provider} references`
  const got = asset.source.type === "ref" ? `; got ${asset.source.provider}:${asset.source.id}` : ""
  return Effect.fail(invalidRequest(`${label} accepts inline bytes, data URLs, http(s) URLs${accepted}${got}`))
}

/**
 * Lift a tool-result file into a `MediaPart`. Tool files carry either a data URL, an `http(s)` URL, or raw base64 in
 * `uri`; the declared `mime` wins over any data-URL prefix so tool authors control the type the model sees.
 */
export const toolFileMedia = (item: Tool.FileContent): MediaPart => {
  const parsed = Media.parseDataUrl(item.uri)
  const asset = parsed
    ? Media.from({ ...parsed.source, mediaType: item.mime })
    : /^https?:\/\//.test(item.uri)
      ? Media.url(item.uri, { mediaType: item.mime })
      : Media.base64(item.uri, item.mime)
  return Message.media(asset, { filename: item.name })
}

export const toolResultText = (part: ToolResultPart) => {
  if (part.result.type === "text") return String(part.result.value)
  if (part.result.type === "error") {
    const value = part.result.value
    const prototype =
      typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value)
    const structured = Array.isArray(value) || prototype === Object.prototype || prototype === null
    return structured && isJson(value) ? encodeJson(value) : String(value)
  }
  return encodeJson(part.result.value)
}

export const errorText = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") return String(error)
  if (error === null) return "null"
  if (error === undefined) return "undefined"
  return "Unknown stream error"
}

/**
 * Canonical invalid-request constructor shared by protocol lowering.
 */
export const invalidRequest = (message: string, cause?: unknown) =>
  new AIError({
    reason: new InvalidRequestError({ message, cause }),
  })

/**
 * Canonical constructor for operations the selected route does not implement.
 * Prefer this over `invalidRequest` when the failure is a missing route
 * capability rather than a malformed caller input, so consumers can branch on
 * `reason._tag` plus `reason.operation` instead of matching message text.
 */
export const unsupportedOperation = (input: {
  readonly operation: string
  readonly message: string
  readonly provider?: ProviderID
  readonly route?: string
  readonly cause?: unknown
}) =>
  new AIError({
    reason: new UnsupportedOperationError({
      operation: input.operation,
      message: input.message,
      provider: input.provider,
      route: input.route,
      cause: input.cause,
    }),
  })

/**
 * Lower namespaces to flat definitions for protocols without a native
 * namespace construct. Leaf names join their namespace path with `_` because
 * `.` is not broadly accepted in provider tool names.
 */
export const flattenTools = (tools: ReadonlyArray<ToolEntry>, path: ReadonlyArray<string> = []) => {
  const flat = tools.flatMap((tool): ReadonlyArray<ToolDefinition> => {
    if (tool.type === "namespace") return flattenTools(tool.tools, [...path, tool.name])
    if (path.length === 0) return [tool]
    return [new ToolDefinition({ ...tool, name: [...path, tool.name].join("_") })]
  })
  return [...new Map(flat.map((tool) => [tool.name, tool])).values()]
}

export const flattenToolRequest = (request: LLMRequest) => {
  const messages = request.messages.map((message) => {
    const content = message.content.map((part) => {
      if ((part.type !== "tool-call" && part.type !== "tool-result") || part.namespace === undefined) return part
      return { ...part, name: `${part.namespace}_${part.name}`, namespace: undefined }
    })
    return content.every((part, index) => part === message.content[index])
      ? message
      : new Message({ ...message, content })
  })
  return {
    tools: flattenTools(request.tools),
    request: messages.every((message, index) => message === request.messages[index])
      ? request
      : LLMRequest.update(request, { messages }),
  }
}

export const matchToolChoice = <Auto, None, Required, Tool>(
  route: string,
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
  cases: {
    readonly auto: () => Auto
    readonly none: () => None
    readonly required: () => Required
    readonly tool: (name: string) => Tool
  },
) =>
  Effect.gen(function* () {
    if (toolChoice.type === "auto") return cases.auto()
    if (toolChoice.type === "none") return cases.none()
    if (toolChoice.type === "required") return cases.required()
    if (!toolChoice.name) return yield* invalidRequest(`${route} tool choice requires a tool name`)
    return cases.tool(toolChoice.name)
  })

type ContentType = ContentPart["type"]

const formatContentTypes = (types: ReadonlyArray<ContentType>) => {
  if (types.length <= 1) return types[0] ?? ""
  if (types.length === 2) return `${types[0]} and ${types[1]}`
  return `${types.slice(0, -1).join(", ")}, and ${types.at(-1)}`
}

export const supportsContent = <const Type extends ContentType>(
  part: ContentPart,
  types: ReadonlyArray<Type>,
): part is Extract<ContentPart, { readonly type: Type }> => (types as ReadonlyArray<ContentType>).includes(part.type)

export const unsupportedContent = (
  route: string,
  role: LLMRequest["messages"][number]["role"],
  types: ReadonlyArray<ContentType>,
) => invalidRequest(`${route} ${role} messages only support ${formatContentTypes(types)} content for now`)

/**
 * Build a `validate` step from a Schema decoder. Replaces the per-route
 * lambda body `(payload) => decode(payload).pipe(Effect.mapError((e) =>
 * invalid(e.message)))`. Any decode error is translated into
 * `AIError` carrying the original parse-error message.
 */
export const validateWith =
  <A, I, E extends { readonly message: string }>(decode: (input: I) => Effect.Effect<A, E>) =>
  (payload: I) =>
    decode(payload).pipe(Effect.mapError((error) => invalidRequest(error.message, error)))

/**
 * Build an HTTP POST with a JSON body. Sets `content-type: application/json`
 * automatically after caller-supplied headers so routes cannot accidentally
 * send JSON with a stale content type. The body is passed pre-encoded so
 * routes can choose between
 * `Schema.encodeSync(payload)` and `ProviderShared.encodeJson(payload)`.
 */
export const jsonPost = (input: { readonly url: string; readonly body: string; readonly headers?: Headers.Input }) =>
  HttpClientRequest.post(input.url).pipe(
    HttpClientRequest.setHeaders(Headers.set(Headers.fromInput(input.headers), "content-type", "application/json")),
    HttpClientRequest.bodyText(input.body, "application/json"),
  )

export * as ProviderShared from "./shared.js"
