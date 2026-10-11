import { Option, Schema, SchemaGetter } from "effect"
import {
  AuthenticationError,
  ContentPolicyError,
  InvalidRequestError,
  AIError,
  ProviderErrorEvent,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  UnknownProviderError,
  type HttpContext,
  type HttpRateLimitDetails,
} from "./schema/index.js"

const patterns = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  // Cloudflare Workers AI reports this as HTTP 413.
  /exceeded this model context window limit/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  // Amazon Nova on Bedrock reports this as a mid-stream validationException.
  /number of input tokens exceeds maximum length/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  // DeepInfra
  /requested input length \d+ exceeds maximum input length/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  // Novita omits the token counts.
  /input(?: \(\d+ tokens\))? is longer than the model'?s context length/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  // Hugging Face Text Generation Inference, e.g. Together
  /`inputs` tokens \+ `max_new_tokens` must be <= \d+/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  // Z.ai code 1261 arrives as `Prompt too long` or `Prompt 超长`.
  /prompt (?:too long|超长)/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /range of input length should be/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /request_too_large/i,
]

const payloadPatterns = [/request entity too large/i, /payload too large/i, /request too large/i]

const exclusions = [
  /^(throttling error|service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
  // Cohere reports an output limit above the model maximum as "too many tokens"; compaction cannot fix it.
  /max[_ ]tokens must be less than/i,
]

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) || /^4(?:00|13)\s*(status code)?\s*\(no body\)/i.test(message))

export const isPayloadTooLarge = (message: string) => payloadPatterns.some((pattern) => pattern.test(message))

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof AIError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"

/**
 * Whether a failed call may succeed when sent again: rate limits, provider-side failures, transport failures that did
 * not deliver an accepted write, and unrecognized failures. Callers decide which calls are safe to repeat.
 */
export const isRetryable = (error: AIError) => {
  const override = error.reason.http?.headers["x-should-retry"]
  if (override === "true") return true
  if (override === "false") return false
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
      return true
    // A WebSocket acknowledgment marks delivery accepted before model output may exist.
    // Read failures can still recover; the caller chooses retry versus continuation from durable output.
    case "Transport":
      return (
        error.reason.delivery !== "rejected" &&
        (error.reason.delivery !== "accepted" || error.reason.operation === "read")
      )
    case "InvalidProviderOutput":
      return error.reason.classification === "incomplete-stream"
    // Unrecognized failures retry: classification records affirmative
    // deterministic evidence, and transient failures are exactly the ones
    // that arrive in shapes no classifier anticipates.
    case "UnknownProvider":
      return true
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidRequest":
    case "UnsupportedOperation":
    case "NoRoute":
    case "Timeout":
      return false
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
// OpenCode Zen reports account caps as typed 429/402 errors that are not throttles.
const QUOTA_CODES = new Set([
  "insufficient_quota",
  "usage_not_included",
  "billing_error",
  "gousagelimiterror",
  "freeusagelimiterror",
  "creditlimitexceeded",
])
// Google reports an invalid API key as HTTP 400 INVALID_ARGUMENT with this `details[].reason`.
// Z.ai's Responses API reports account and plan rejections mid-stream as `permission_denied`.
const AUTH_CODES = new Set(["authentication_error", "permission_error", "permission_denied", "api_key_invalid"])
const SERVER_CODES = new Set([
  "api_error",
  "internal_error",
  "internalserverexception",
  "modelstreamerrorexception",
  "overloaded_error",
  "server_error",
  "server_is_overloaded",
  "slow_down",
  "serviceunavailableexception",
])
// `invalid_request` is the Vercel AI Gateway's code for an upstream request rejection.
// xAI reports an undecodable image over WebSocket with no status as `invalid_image` under type `api_error`.
const INVALID_REQUEST_CODES = new Set([
  "invalid_image",
  "model_not_found",
  "invalid_prompt",
  "invalid_request",
  "invalid_request_error",
  "validationexception",
])
// Azure OpenAI reports `content_filter` with `innererror.code` ResponsibleAIPolicyViolation.
// OpenRouter tags provider failures with a typed `error_type`; its Responses skin also
// emits `image_content_policy_violation` as the native code.
const CONTENT_POLICY_CODES = new Set([
  "content_filter",
  "content_moderation",
  "responsibleaipolicyviolation",
  "content_policy_violation",
  "image_content_policy_violation",
  "refusal",
])
// OpenCode Zen replaces upstream codes outside its allow-list but keeps the original
// as a `[code]` label at the start of the rewritten message.
const GATEWAY_CODE_LABEL = /^[^:\n]+: \[([A-Za-z0-9_.-]+)\]/
// xAI reports an invalid API key as HTTP 400 with the generic `invalid-argument` code.
const AUTH_TEXT = /incorrect api key provided/i
const RATE_LIMIT_TEXT = /rate increased too quickly|rate[-_\s]?limit|too[_\s]?many[_\s]?requests/i
// Only consulted on 429, where throttles and account caps share a status.
// Z.ai reports balance, plan expiry, plan limits, and plan model access on 429.
const QUOTA_TEXT =
  /insufficient[-_\s]?(?:quota|balance)|quota[-_\s]?exceeded|budget exceeded|usage limit|limit exhausted|package has expired|plan does not yet include/i
// Policy rejections without a dedicated code, matched against the provider's own
// explanation only. OpenAI reuses `invalid_prompt` for usage-policy rejections while
// Bedrock Mantle reuses it for schema validation; Anthropic reports blocked output
// under `invalid_request_error`.
const CONTENT_POLICY_TEXT =
  /violating our usage policy|blocked by content filtering policy|content[-_\s]?policy|rejected as a result of our safety system|detected potentially unsafe or sensitive content/i
const SERVER_ERROR_TEXT =
  /\b(?:try again|(?:please |you can )?retry (?:the |this |your )?request|try (?:the |this |your )?request again|(?:currently |temporarily )?at capacity|overloaded|temporarily unavailable|service[-_\s]?unavailable|(?:server|internal)[-_\s]?error|server (?:is )?busy|provider returned (?:an )?error|resource[-_\s]?exhausted|upstream (?:connect|connection|request)|request buffer limit while retrying upstream)\b/i

const Message = Schema.String.check(Schema.isPattern(/\S/))

const messageAt = <Fields extends Schema.Struct.Fields>(
  fields: Fields,
  message: (body: Schema.Struct<Fields>["Type"]) => string,
) =>
  Schema.Struct(fields).pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform(message),
      encode: SchemaGetter.forbidden(() => "Provider error messages are decode-only"),
    }),
  )

// Common error body layouts that carry a human-readable message, in priority order.
// Provider-specific layouts belong in their protocol.
const decodeMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([
      messageAt({ error: Schema.Struct({ message: Message }) }, (body) => body.error.message),
      messageAt({ error: Message }, (body) => body.error),
      messageAt({ message: Message }, (body) => body.message),
      // AWS services
      messageAt({ Message: Message }, (body) => body.Message),
      // RFC 9457 problem details
      messageAt({ detail: Message }, (body) => body.detail),
      messageAt(
        { errors: Schema.NonEmptyArray(Schema.Struct({ message: Message })) },
        (body) => body.errors[0].message,
      ),
    ]),
  ),
)

export const providerErrorMessage = (body: string) => Option.getOrUndefined(decodeMessage(body))

export interface ProviderFailure {
  readonly message: string
  readonly status?: number | undefined
  // Raw wire payload, scanned for failure signals (codes, overflow phrases)
  // that the summary message does not carry. Not shown to users.
  readonly rawBody?: string | undefined
  // Some SDKs supply parsed error data separately from the original response text.
  readonly data?: unknown
  readonly http?: HttpContext | undefined
  readonly cause?: unknown
  readonly retryAfterMs?: number | undefined
  readonly rateLimit?: HttpRateLimitDetails | undefined
}

// Classification records affirmative evidence about a failure. Deterministic
// failures need positive identification (a 4xx status, quota/auth/policy
// signals); anything unrecognized stays UnknownProvider, which the session
// retry policy treats as retry-eligible because transient failures arrive in
// unpredictable shapes while deterministic rejections almost always carry a
// status or known code.
export function classifyProviderFailure(input: ProviderFailure): AIError["reason"] {
  const details = { message: input.message, body: input.rawBody, http: input.http, cause: input.cause }
  const body = input.rawBody ?? ""
  const codes = [
    ...providerCodes(input.data),
    ...providerCodes(body),
    ...providerCodes(input.message),
    ...(GATEWAY_CODE_LABEL.exec(input.message)?.slice(1) ?? []),
  ].map((code) => code.toLowerCase())
  // Scan the raw payload too so signals missing from the summary message
  // (e.g. overflow phrases nested in a JSON error body) still classify.
  const text = [input.message, body].filter((value) => value.length > 0).join("\n")
  const clientScoped = input.status === undefined || (input.status >= 400 && input.status < 500)

  if (
    clientScoped &&
    (codes.includes("context_length_exceeded") ||
      codes.includes("model_context_window_exceeded") ||
      codes.includes("request_too_large") ||
      isContextOverflow(text))
  )
    return new InvalidRequestError({ ...details, classification: "context-overflow" })
  if (input.status === 413 || isPayloadTooLarge(text))
    return new InvalidRequestError({ ...details, classification: "payload-too-large" })
  if (codes.some((code) => CONTENT_POLICY_CODES.has(code)) || (clientScoped && CONTENT_POLICY_TEXT.test(input.message)))
    return new ContentPolicyError(details)
  if (
    input.status === 402 ||
    codes.some((code) => QUOTA_CODES.has(code)) ||
    (input.status === 429 && QUOTA_TEXT.test(text))
  )
    return new QuotaExceededError(details)
  if (
    input.status === 401 ||
    input.status === 403 ||
    codes.some((code) => AUTH_CODES.has(code)) ||
    (input.status === 400 && AUTH_TEXT.test(text))
  )
    return new AuthenticationError(details)
  if (
    input.status === 429 ||
    codes.some(
      (code) => code.includes("rate_limit") || code === "too_many_requests" || code === "throttlingexception",
    ) ||
    RATE_LIMIT_TEXT.test(text)
  )
    return new RateLimitError({
      ...details,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
    })
  if (
    input.status === 408 ||
    input.status === 409 ||
    (input.status !== undefined && input.status >= 500) ||
    // Server codes and phrasing only decide when no HTTP status contradicts them:
    // gateways such as OpenCode Zen substitute `server_error` for codes they do
    // not forward, so a 4xx with a server code is still a rejected request.
    // A specific invalid-request code outranks a generic server code or phrase in the same body.
    ((input.status === undefined || input.status < 400) &&
      !codes.some((code) => INVALID_REQUEST_CODES.has(code)) &&
      (SERVER_ERROR_TEXT.test(text) ||
        codes.some((code) => SERVER_CODES.has(code) || code.includes("exhausted") || code.includes("unavailable"))))
  )
    return new ProviderInternalError({
      ...details,
      retryAfterMs: input.retryAfterMs,
    })
  if (codes.some((code) => INVALID_REQUEST_CODES.has(code))) return new InvalidRequestError(details)
  // Any remaining 4xx is a deterministic rejection of this request.
  if (input.status !== undefined && input.status >= 400 && input.status < 500) return new InvalidRequestError(details)
  return new UnknownProviderError(details)
}

function providerCodes(value: unknown) {
  const decoded = typeof value === "string" ? Option.getOrUndefined(decodeJson(value)) : value
  if (!isRecord(decoded)) return []
  const error = isRecord(decoded.error) ? decoded.error : undefined
  const inner = error && isRecord(error.innererror) ? error.innererror : undefined
  const metadata = error && isRecord(error.metadata) ? error.metadata : undefined
  const response = isRecord(decoded.response) ? decoded.response : undefined
  const responseError = response && isRecord(response.error) ? response.error : undefined
  const exception = isRecord(decoded.exception) ? decoded.exception : undefined
  return [
    decoded.code,
    // Stability's `{ id, name, errors }` bodies carry the code in `name`.
    Array.isArray(decoded.errors) ? decoded.name : undefined,
    decoded.error_type,
    error?.code,
    error?.type,
    error?.status,
    error?.error_type,
    // Google `google.rpc.ErrorInfo` details carry the specific reason.
    ...(Array.isArray(error?.details)
      ? error.details.map((detail) => (isRecord(detail) ? detail.reason : undefined))
      : []),
    inner?.code,
    metadata?.error_type,
    responseError?.code,
    response?.error_type,
    exception?.type,
  ].filter((value): value is string => typeof value === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
