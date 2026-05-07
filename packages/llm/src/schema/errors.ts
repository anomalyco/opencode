import { Schema } from "effect"
import { ModelID, ProviderID, ProviderMetadata, RouteID } from "./ids"

export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>("LLM.HttpRequestDetails")({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>("LLM.HttpResponseDetails")({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>("LLM.HttpRateLimitDetails")({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class HttpContext extends Schema.Class<HttpContext>("LLM.HttpContext")({
  request: HttpRequestDetails,
  response: Schema.optional(HttpResponseDetails),
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  requestId: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>("LLM.Error.InvalidRequest")({
  _tag: Schema.tag("InvalidRequest"),
  message: Schema.String,
  parameter: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class NoRouteReason extends Schema.Class<NoRouteReason>("LLM.Error.NoRoute")({
  _tag: Schema.tag("NoRoute"),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {
  get retryable() {
    return false
  }

  get message() {
    return `No LLM route for ${this.provider}/${this.model} using ${this.route}`
  }
}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>("LLM.Error.Authentication")({
  _tag: Schema.tag("Authentication"),
  message: Schema.String,
  kind: Schema.Literals(["missing", "invalid", "expired", "insufficient-permissions", "unknown"]),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class RateLimitReason extends Schema.Class<RateLimitReason>("LLM.Error.RateLimit")({
  _tag: Schema.tag("RateLimit"),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true
  }
}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>("LLM.Error.QuotaExceeded")({
  _tag: Schema.tag("QuotaExceeded"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>("LLM.Error.ContentPolicy")({
  _tag: Schema.tag("ContentPolicy"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>("LLM.Error.ProviderInternal")({
  _tag: Schema.tag("ProviderInternal"),
  message: Schema.String,
  status: Schema.Number,
  retryAfterMs: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true
  }
}

export class TransportReason extends Schema.Class<TransportReason>("LLM.Error.Transport")({
  _tag: Schema.tag("Transport"),
  message: Schema.String,
  kind: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class InvalidProviderOutputReason extends Schema.Class<InvalidProviderOutputReason>(
  "LLM.Error.InvalidProviderOutput",
)({
  _tag: Schema.tag("InvalidProviderOutput"),
  message: Schema.String,
  route: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get retryable() {
    return false
  }
}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>("LLM.Error.UnknownProvider")({
  _tag: Schema.tag("UnknownProvider"),
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export const LLMErrorReason = Schema.Union([
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
export type LLMErrorReason = Schema.Schema.Type<typeof LLMErrorReason>

export class LLMError extends Schema.TaggedErrorClass<LLMError>()("LLM.Error", {
  module: Schema.String,
  method: Schema.String,
  reason: LLMErrorReason,
}) {
  override readonly cause = this.reason

  get retryable() {
    return this.reason.retryable
  }

  get retryAfterMs() {
    return "retryAfterMs" in this.reason ? this.reason.retryAfterMs : undefined
  }

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
export class ToolFailure extends Schema.TaggedErrorClass<ToolFailure>()("LLM.ToolFailure", {
  message: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
