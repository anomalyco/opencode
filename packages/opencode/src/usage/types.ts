import { Schema } from "effect"

export const planTypeSchema = Schema.Literals([
  "guest",
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "free_workspace",
  "team",
  "business",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "education",
  "quorum",
  "k12",
  "enterprise",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "edu",
  "unknown",
] as const)
export type PlanType = Schema.Schema.Type<typeof planTypeSchema>

export const rateLimitWindowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  usedPercent: Schema.Finite,
  windowMinutes: Schema.NullOr(Schema.Finite),
  resetsAt: Schema.NullOr(Schema.Finite),
})
export type RateLimitWindow = Schema.Schema.Type<typeof rateLimitWindowSchema>

export const creditsSnapshotSchema = Schema.Struct({
  hasCredits: Schema.Boolean,
  unlimited: Schema.Boolean,
  balance: Schema.NullOr(Schema.String),
  label: Schema.optional(Schema.String),
  overagePermitted: Schema.optional(Schema.Boolean),
  total: Schema.optional(Schema.NullOr(Schema.Finite)),
  used: Schema.optional(Schema.NullOr(Schema.Finite)),
  remaining: Schema.optional(Schema.NullOr(Schema.Finite)),
})
export type CreditsSnapshot = Schema.Schema.Type<typeof creditsSnapshotSchema>

export const snapshotSchema = Schema.Struct({
  windows: Schema.Array(rateLimitWindowSchema),
  credits: Schema.NullOr(creditsSnapshotSchema),
  planType: Schema.NullOr(planTypeSchema),
  updatedAt: Schema.Finite,
})
export type Snapshot = Schema.Schema.Type<typeof snapshotSchema>

export const resultStatusSchema = Schema.Literals([
  "ok",
  "stale",
  "unavailable",
  "unauthenticated",
  "unsupported",
] as const)
export type ResultStatus = Schema.Schema.Type<typeof resultStatusSchema>

export const resultErrorCodeSchema = Schema.Literals([
  "fetch_failed",
  "missing_auth",
  "missing_oauth",
  "reauth_required",
  "unsupported_provider",
] as const)
export type ResultErrorCode = Schema.Schema.Type<typeof resultErrorCodeSchema>

export const resultErrorSchema = Schema.Struct({
  code: resultErrorCodeSchema,
  message: Schema.String,
  retryable: Schema.Boolean,
}).annotate({ identifier: "UsageResultError" })
export type ResultError = Schema.Schema.Type<typeof resultErrorSchema>

export const resultSchema = Schema.Struct({
  provider: Schema.String,
  displayName: Schema.String,
  status: resultStatusSchema,
  snapshot: Schema.NullOr(snapshotSchema),
  error: Schema.optionalKey(resultErrorSchema),
}).annotate({ identifier: "UsageResult" })
export type Result = Schema.Schema.Type<typeof resultSchema>

export const responseSchema = Schema.Struct({
  results: Schema.Array(resultSchema),
}).annotate({ identifier: "UsageResponse" })
export type Response = Schema.Schema.Type<typeof responseSchema>

// Provider fetchers never refresh or persist credentials: a usage read must not
// race the inference plugins' token refresh (rotating refresh tokens can revoke
// the family on reuse). Expired or rejected credentials surface as kind "auth".
export type UsageFetchError = {
  message: string
  // "transient" errors may succeed on retry without user action; "auth" errors
  // need inference to refresh the token or a re-login.
  kind: "transient" | "auth"
}

export type UsageFetchResult = {
  snapshot: Snapshot | null
  error?: UsageFetchError
  // Local provider caches can be displayed without copying them into the
  // process snapshot cache, where account selection changes are invisible.
  cacheable?: boolean
}
