import { Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { ModelID, ProviderID, RouteID } from "./ids.js"
import { ProviderMetadata } from "./messages.js"

export const ProviderFailureClassification = Schema.Literals(["context-overflow", "payload-too-large"])
export type ProviderFailureClassification = typeof ProviderFailureClassification.Type

export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>("AI.HttpRequestDetails")({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>("AI.HttpResponseDetails")({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>("AI.HttpRateLimitDetails")({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class HttpContext extends Schema.Class<HttpContext>("AI.HttpContext")({
  request: HttpRequestDetails,
  response: Schema.optional(HttpResponseDetails),
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>("AI.Error.InvalidRequest")({
  _tag: Schema.tag("InvalidRequest"),
  message: Schema.String,
  parameter: Schema.optional(Schema.String),
  classification: Schema.optional(ProviderFailureClassification),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export class NoRouteReason extends Schema.Class<NoRouteReason>("AI.Error.NoRoute")({
  _tag: Schema.tag("NoRoute"),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {
  get message() {
    return `No AI route for ${this.provider}/${this.model} using ${this.route}`
  }
}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>("AI.Error.Authentication")({
  _tag: Schema.tag("Authentication"),
  message: Schema.String,
  kind: Schema.Literals(["missing", "invalid", "expired", "insufficient-permissions", "unknown"]),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export class RateLimitReason extends Schema.Class<RateLimitReason>("AI.Error.RateLimit")({
  _tag: Schema.tag("RateLimit"),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>("AI.Error.QuotaExceeded")({
  _tag: Schema.tag("QuotaExceeded"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>("AI.Error.ContentPolicy")({
  _tag: Schema.tag("ContentPolicy"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>("AI.Error.ProviderInternal")({
  _tag: Schema.tag("ProviderInternal"),
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  retryAfterMs: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export const TransportType = Schema.Literals(["http", "websocket"])
export type TransportType = typeof TransportType.Type

export const TransportOperation = Schema.Literals(["request", "read", "write"])
export type TransportOperation = typeof TransportOperation.Type

export class TransportReason extends Schema.Class<TransportReason>("AI.Error.Transport")({
  _tag: Schema.tag("Transport"),
  message: Schema.String,
  transport: TransportType,
  operation: TransportOperation,
  code: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  http: Schema.optional(HttpContext),
  phase: Schema.optional(
    Schema.Literals(["prepare", "queue", "connect", "send", "receive", "decode", "complete", "fallback", "close"]),
  ),
  delivery: Schema.optional(Schema.Literals(["not-sent", "rejected", "ambiguous", "accepted"])),
  recovery: Schema.optional(
    Schema.Literals(["retry-connect", "retry-full", "rotate-and-retry-full", "fallback-http", "fail"]),
  ),
}) {}

export class InvalidProviderOutputReason extends Schema.Class<InvalidProviderOutputReason>(
  "AI.Error.InvalidProviderOutput",
)({
  _tag: Schema.tag("InvalidProviderOutput"),
  message: Schema.String,
  classification: Schema.optional(Schema.Literals(["incomplete-stream"])),
  route: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>("AI.Error.UnknownProvider")({
  _tag: Schema.tag("UnknownProvider"),
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {}

export const AIErrorReason = Schema.Union([
  InvalidRequestReason,
  NoRouteReason,
  AuthenticationReason,
  RateLimitReason,
  QuotaExceededReason,
  ContentPolicyReason,
  ProviderInternalReason,
  TransportReason,
  InvalidProviderOutputReason,
  UnknownProviderReason,
]).pipe(Schema.toTaggedUnion("_tag"))
export type AIErrorReason = Schema.Schema.Type<typeof AIErrorReason>

export class AIError extends Schema.TaggedError<AIError>()("AI.Error", {
  module: Schema.String,
  method: Schema.String,
  reason: AIErrorReason,
  // Raw provider payload as a string, so classified failures never lose the
  // original error detail even when the pretty message is a summary.
  body: Schema.optional(Schema.String),
}) {
  override readonly cause = this.reason

  override get message() {
    return `${this.module}.${this.method}: ${this.reason.message}`
  }
}

/**
 * Failure type for tool execute handlers. Handlers must map their internal
 * errors to this shape; the runtime catches `ToolFailure`s and surfaces them
 * as `tool-error` events plus a `tool-result` of `type: "error"` so the model
 * can self-correct.
 *
 * Anything thrown or yielded by a handler that is not a `ToolFailure` is
 * treated as a defect and fails the stream.
 */
export class ToolFailure extends Tool.Error {}
