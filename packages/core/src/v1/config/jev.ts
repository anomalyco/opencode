export * as ConfigJevV1 from "./jev"

import { Schema } from "effect"

const Hour = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }))
const UnitInterval = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const Tier = Schema.Struct({
  id: Schema.NonEmptyString.annotate({ description: "Stable tier identifier" }),
  model: Schema.String.annotate({ description: "Model this tier maps to, in the format provider/model" }),
  capability: Schema.NonEmptyString.annotate({
    description:
      "Free-text eligibility test describing what this tier handles well (never a model name). This is how the router learns your pool.",
  }),
  costHintUsdPerMTokOut: Schema.optional(Schema.Number).annotate({
    description: "Reporting only; the router never optimizes cost",
  }),
  window: Schema.optional(
    Schema.Struct({
      startHour: Hour,
      endHour: Hour,
      utcOffsetMinutes: Schema.Int,
    }),
  ).annotate({
    description: "Tier is only eligible inside this local-time window; startHour may be > endHour to wrap midnight",
  }),
  maxContextTokens: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Requests above this context size are ineligible",
  }),
  quota: Schema.optional(Schema.Struct({ used: Schema.Number, limit: Schema.Number })).annotate({
    description: "Budget for the current period; omit for unmetered tiers",
  }),
  rate: Schema.optional(Schema.Struct({ used: Schema.Number, limit: Schema.Number })).annotate({
    description: "Rolling request cap",
  }),
})
export type Tier = Schema.Schema.Type<typeof Tier>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable Jev decision routing (default: false)" }),
  tiers: Schema.optional(Schema.mutable(Schema.Array(Tier))).annotate({
    description:
      "Model tiers ordered cheapest -> most capable. Order is load-bearing: the last tier is the fail-open default. Define the pool so its most capable tier matches your default model.",
  }),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 10_000 }))).annotate({
    description: "Hard timeout for a Jev call (default: 1500ms); on timeout the router fails open",
  }),
  thresholds: Schema.optional(
    Schema.Struct({
      minConfidenceToDegrade: Schema.optional(UnitInterval).annotate({
        description:
          "Confidence required to route DOWN to a cheaper tier (default: 0.85; flat-capability pools may use 0.55-0.65)",
      }),
      maxComplexityForDegrade: Schema.optional(UnitInterval).annotate({
        description: "Complexity score at or below which degrading is allowed (default: 0.5)",
      }),
      minComplexityConfidence: Schema.optional(UnitInterval).annotate({
        description: "Minimum confidence in the complexity score to degrade (default: 0.5)",
      }),
      allowVerify: Schema.optional(Schema.Boolean).annotate({
        description: "Enable post-hoc adequacy verification and escalation (default: true)",
      }),
      minConfidenceToEscalate: Schema.optional(UnitInterval).annotate({
        description: "Confidence required to act on an 'inadequate' verdict (default: 0.7)",
      }),
      maxEscalationsPerTurn: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).annotate({
        description: "Re-runs allowed per turn after a failed verification (default: 1)",
      }),
    }),
  ).annotate({ description: "Routing thresholds — pool-specific, tune per pool shape" }),
})
export type Info = Schema.Schema.Type<typeof Info>
