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

export class Notebook extends Schema.Class<Notebook>("ConfigV2.Experimental.Notebook")({
  attach: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Attach the relevant per-file notebook note to read/edit/write output on first touch (default: true)",
  }),
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  notebook: Notebook.pipe(Schema.optional).annotate({
    description: "Notebook memory behavior",
  }),
}) {}
