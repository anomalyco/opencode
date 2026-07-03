export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy } from "../policy"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

class PolicyConfig extends Schema.Class<PolicyConfig>("ConfigV2.Experimental.Policy")({
  ...Policy.Info.fields,
  action: PolicyAction,
}) {}

export { PolicyConfig as Policy }

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: PolicyConfig.pipe(Schema.Array, Schema.optional),
}) {}
