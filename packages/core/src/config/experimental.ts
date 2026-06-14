export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

// Fission-inspired Agent Criticality (ACE) controls. Treats sub-agent spawning
// as a branching process: k_eff = (nu * f) / (alpha + epsilon). In "monitor"
// mode the orchestrator only measures and emits criticality metrics; in "gate"
// mode it acts as a cascade circuit breaker, rejecting spawns that exceed the
// depth limit D_max, the k_eff threshold, or the cost budget.
export class Criticality extends Schema.Class<Criticality>("ConfigV2.Experimental.Criticality")({
  mode: Schema.Union([Schema.Literal("monitor"), Schema.Literal("gate")])
    .pipe(Schema.optional)
    .annotate({
      description:
        "'monitor' (default): measure and emit criticality metrics, never block. 'gate': act as a circuit breaker and reject spawns that exceed the limits below.",
    }),

  // Semantic names (documented, preferred).
  k_eff_threshold: Schema.Number.pipe(Schema.optional).annotate({
    description:
      "Reject a spawn when the agent multiplication factor k_eff exceeds this value. Higher = more permissive. Default 1.5.",
  }),
  max_active_agents: Schema.Number.pipe(Schema.optional).annotate({
    description: "Population ceiling (N_max) used to derive the cascade depth limit D_max. Default 64.",
  }),
  sliding_window_ms: Schema.Number.pipe(Schema.optional).annotate({
    description: "Time window over which spawn/absorption rates (nu, f, alpha) are estimated. Default 60000.",
  }),
  epsilon: Schema.Number.pipe(Schema.optional).annotate({
    description: "Small guard in (0, 1) preventing division by zero in early/empty windows. Default 0.1.",
  }),
  budget_usd: Schema.Number.pipe(Schema.optional).annotate({
    description: "Optional cost ceiling for the whole cascade (root session + descendants). Unset = no budget gate.",
  }),

  // Legacy math names (still accepted; superseded by the semantic names above).
  k_upper: Schema.Number.pipe(Schema.optional).annotate({ description: "Legacy alias for k_eff_threshold." }),
  n_max: Schema.Number.pipe(Schema.optional).annotate({ description: "Legacy alias for max_active_agents." }),
  window_ms: Schema.Number.pipe(Schema.optional).annotate({ description: "Legacy alias for sliding_window_ms." }),
}) {}

// Always-on budget & runaway guard. Independent of multi-agent ACE: applies to
// every session. Emits early warnings as the session approaches its spend cap and
// (by default) stops gracefully before exceeding it.
export class Budget extends Schema.Class<Budget>("ConfigV2.Experimental.Budget")({
  usd: Schema.Number.pipe(Schema.optional).annotate({
    description: "Spend cap in USD for a single session. Unset = no budget guard.",
  }),
  warn_at: Schema.Number.pipe(Schema.Array, Schema.optional).annotate({
    description: "Fractions of the cap at which to warn the model once (default [0.5, 0.8]).",
  }),
  on_exceed: Schema.Union([Schema.Literal("stop"), Schema.Literal("warn")])
    .pipe(Schema.optional)
    .annotate({
      description:
        "'stop' (default): halt the session gracefully before exceeding the cap. 'warn': keep going but inject a final over-budget warning.",
    }),
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  criticality: Schema.optional(Criticality),
  budget: Schema.optional(Budget),
}) {}
