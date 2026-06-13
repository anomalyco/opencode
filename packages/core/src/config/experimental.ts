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
  mode: Schema.optional(Schema.Literal("monitor", "gate")),
  k_upper: Schema.optional(Schema.Number),
  n_max: Schema.optional(Schema.Number),
  window_ms: Schema.optional(Schema.Number),
  epsilon: Schema.optional(Schema.Number),
  budget_usd: Schema.optional(Schema.Number),
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  criticality: Schema.optional(Criticality),
}) {}
