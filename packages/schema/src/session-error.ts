export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

const Message = { message: Schema.String }

const ProviderRateLimit = Schema.Struct({
  type: Schema.Literal("provider.rate-limit"),
  ...Message,
  retryAfterMs: Schema.Finite.pipe(optional),
})
const ProviderAuth = Schema.Struct({ type: Schema.Literal("provider.auth"), ...Message })
const ProviderQuota = Schema.Struct({ type: Schema.Literal("provider.quota"), ...Message })
const ProviderContentFilter = Schema.Struct({ type: Schema.Literal("provider.content-filter"), ...Message })
const ProviderTransport = Schema.Struct({ type: Schema.Literal("provider.transport"), ...Message })
const ProviderInternal = Schema.Struct({ type: Schema.Literal("provider.internal"), ...Message })
const ProviderInvalidOutput = Schema.Struct({ type: Schema.Literal("provider.invalid-output"), ...Message })
const ProviderInvalidRequest = Schema.Struct({ type: Schema.Literal("provider.invalid-request"), ...Message })
const ProviderNoRoute = Schema.Struct({ type: Schema.Literal("provider.no-route"), ...Message })
const ProviderUnknown = Schema.Struct({ type: Schema.Literal("provider.unknown"), ...Message })
const PermissionRejected = Schema.Struct({
  type: Schema.Literal("permission.rejected"),
  ...Message,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
})
const ToolUnknown = Schema.Struct({ type: Schema.Literal("tool.unknown"), ...Message, name: Schema.String })
const ToolStale = Schema.Struct({
  type: Schema.Literal("tool.stale"),
  ...Message,
  name: Schema.String.pipe(optional),
})
const ToolExecution = Schema.Struct({ type: Schema.Literal("tool.execution"), ...Message })
const ToolResultMissing = Schema.Struct({
  type: Schema.Literal("tool.result-missing"),
  ...Message,
  callID: Schema.String.pipe(optional),
})
const Aborted = Schema.Struct({
  type: Schema.Literal("aborted"),
  ...Message,
  reason: Schema.Literals(["user", "shutdown", "timeout"]).pipe(optional),
})
const Unknown = Schema.Struct({
  type: Schema.Literal("unknown"),
  ...Message,
  agent: Schema.String.pipe(optional),
})

export const Error = Schema.Union([
  ProviderRateLimit,
  ProviderAuth,
  ProviderQuota,
  ProviderContentFilter,
  ProviderTransport,
  ProviderInternal,
  ProviderInvalidOutput,
  ProviderInvalidRequest,
  ProviderNoRoute,
  ProviderUnknown,
  PermissionRejected,
  ToolUnknown,
  ToolStale,
  ToolExecution,
  ToolResultMissing,
  Aborted,
  Unknown,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.StructuredError" })
export type Error = typeof Error.Type
