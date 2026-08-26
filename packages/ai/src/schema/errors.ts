import { Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { ModelID, ProviderID, RouteID } from "./ids.js"

export const ProviderFailureClassification = Schema.Literals(["context-overflow", "payload-too-large"])
export type ProviderFailureClassification = typeof ProviderFailureClassification.Type

export class HttpContext extends Schema.Class<HttpContext>("AI.HttpContext")({
  url: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>("AI.HttpRateLimitDetails")({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>("AI.Error.InvalidRequest")({
  _tag: Schema.tag("InvalidRequest"),
  parameter: Schema.optional(Schema.String),
  classification: Schema.optional(ProviderFailureClassification),
}) {}

export class NoRouteReason extends Schema.Class<NoRouteReason>("AI.Error.NoRoute")({
  _tag: Schema.tag("NoRoute"),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>("AI.Error.Authentication")({
  _tag: Schema.tag("Authentication"),
  kind: Schema.Literals(["missing", "invalid", "expired", "insufficient-permissions", "unknown"]),
}) {}

export class RateLimitReason extends Schema.Class<RateLimitReason>("AI.Error.RateLimit")({
  _tag: Schema.tag("RateLimit"),
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>("AI.Error.QuotaExceeded")({
  _tag: Schema.tag("QuotaExceeded"),
}) {}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>("AI.Error.ContentPolicy")({
  _tag: Schema.tag("ContentPolicy"),
}) {}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>("AI.Error.ProviderInternal")({
  _tag: Schema.tag("ProviderInternal"),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

export const TransportType = Schema.Literals(["http", "websocket"])
export type TransportType = typeof TransportType.Type

export const TransportOperation = Schema.Literals(["request", "read", "write"])
export type TransportOperation = typeof TransportOperation.Type

export class TransportReason extends Schema.Class<TransportReason>("AI.Error.Transport")({
  _tag: Schema.tag("Transport"),
  transport: TransportType,
  operation: TransportOperation,
  code: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
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
  classification: Schema.optional(Schema.Literals(["incomplete-stream"])),
  route: Schema.optional(Schema.String),
}) {}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>("AI.Error.UnknownProvider")({
  _tag: Schema.tag("UnknownProvider"),
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
  message: Schema.String,
  reason: AIErrorReason,
  // Raw provider payload as a string, so classified failures never lose the
  // original error detail even when the pretty message is a summary.
  body: Schema.optional(Schema.String),
  http: Schema.optional(HttpContext),
  cause: Schema.optional(Schema.Defect({ includeStack: true })),
}) {}

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
