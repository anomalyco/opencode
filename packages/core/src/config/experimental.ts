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

export class Voice extends Schema.Class<Voice>("ConfigV2.Experimental.Voice")({
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable experimental browser voice input backed by a local whisper.cpp server",
  }),
  whisper_url: Schema.String.pipe(Schema.optional).annotate({
    description: "Local whisper.cpp server URL required to enable browser voice input",
  }),
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  voice:    Voice.pipe(Schema.optional),
}) {}
