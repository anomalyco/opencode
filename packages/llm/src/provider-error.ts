import { Option, Schema } from "effect"
import {
  AuthenticationReason,
  ContentPolicyReason,
  InvalidRequestReason,
  LLMError,
  ProviderErrorEvent,
  ProviderInternalReason,
  QuotaExceededReason,
  RateLimitReason,
  UnknownProviderReason,
  type HttpContext,
  type HttpRateLimitDetails,
  type ProviderMetadata,
} from "./schema"

const patterns = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
]

export const isContextOverflow = (message: string) =>
  patterns.some((pattern) => pattern.test(message)) || /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const QUOTA_CODES = new Set(["insufficient_quota", "usage_not_included", "billing_error"])
const SERVER_CODES = new Set([
  "api_error",
  "internal_error",
  "internalserverexception",
  "modelstreamerrorexception",
  "overloaded_error",
  "server_error",
  "server_is_overloaded",
  "serviceunavailableexception",
])
const INVALID_REQUEST_CODES = new Set(["invalid_prompt", "invalid_request_error", "validationexception"])
const RATE_LIMIT_TEXT = /rate increased too quickly|rate[-_\s]?limit|too[_\s]?many[_\s]?requests/i
const QUOTA_TEXT = /insufficient[-_\s]?quota|quota[-_\s]?exceeded/i
const CONTENT_POLICY_TEXT = /content[-_\s]?policy|content_filter|safety/i

export interface ProviderFailure {
  readonly message: string
  readonly status?: number | undefined
  readonly code?: string | undefined
  readonly retryAfterMs?: number | undefined
  readonly rateLimit?: HttpRateLimitDetails | undefined
  readonly http?: HttpContext | undefined
  readonly providerMetadata?: ProviderMetadata | undefined
}

// Keep HTTP failures and provider-reported stream failures on one typed path so
// session retry policy never needs provider-specific string matching.
export function classifyProviderFailure(input: ProviderFailure): LLMError["reason"] {
  const body = input.http?.body ?? ""
  const code = input.code ?? providerCode(body) ?? providerCode(input.message)
  const normalizedCode = code?.toLowerCase()
  const text = body || input.message
  const common = { message: input.message, providerMetadata: input.providerMetadata, http: input.http }
  const clientScoped = input.status === undefined || (input.status >= 400 && input.status < 500)

  if (
    clientScoped &&
    (normalizedCode === "context_length_exceeded" ||
      normalizedCode === "model_context_window_exceeded" ||
      isContextOverflow(text))
  )
    return new InvalidRequestReason({ ...common, classification: "context-overflow" })
  if (CONTENT_POLICY_TEXT.test(text)) return new ContentPolicyReason(common)
  if (
    (normalizedCode !== undefined && QUOTA_CODES.has(normalizedCode)) ||
    (input.status === 429 && QUOTA_TEXT.test(text))
  )
    return new QuotaExceededReason(common)
  if (input.status === 401) return new AuthenticationReason({ ...common, kind: "invalid" })
  if (input.status === 403) return new AuthenticationReason({ ...common, kind: "insufficient-permissions" })
  if (normalizedCode === "authentication_error") return new AuthenticationReason({ ...common, kind: "invalid" })
  if (normalizedCode === "permission_error")
    return new AuthenticationReason({ ...common, kind: "insufficient-permissions" })
  if (
    normalizedCode !== undefined &&
    (normalizedCode.includes("rate_limit") ||
      normalizedCode === "too_many_requests" ||
      normalizedCode === "throttlingexception")
  )
    return new RateLimitReason({
      ...common,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
    })
  if (RATE_LIMIT_TEXT.test(text))
    return new RateLimitReason({
      ...common,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
    })
  if (
    normalizedCode !== undefined &&
    (SERVER_CODES.has(normalizedCode) || normalizedCode.includes("exhausted") || normalizedCode.includes("unavailable"))
  )
    return new ProviderInternalReason({
      ...common,
      status: input.status,
      retryAfterMs: input.retryAfterMs,
    })
  if (input.status === 429) {
    return new RateLimitReason({
      ...common,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
    })
  }
  if (input.status !== undefined && input.status >= 500)
    return new ProviderInternalReason({
      ...common,
      status: input.status,
      retryAfterMs: input.retryAfterMs,
    })
  if (normalizedCode !== undefined && INVALID_REQUEST_CODES.has(normalizedCode)) return new InvalidRequestReason(common)
  if (
    input.status === 400 ||
    input.status === 404 ||
    input.status === 409 ||
    input.status === 413 ||
    input.status === 422
  )
    return new InvalidRequestReason(common)
  return new UnknownProviderReason({ ...common, status: input.status })
}

function providerCode(value: string) {
  const decoded = Option.getOrUndefined(decodeJson(value))
  if (!isRecord(decoded)) return undefined
  const error = isRecord(decoded.error) ? decoded.error : undefined
  return [decoded.code, error?.code, error?.type].find((value): value is string => typeof value === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
