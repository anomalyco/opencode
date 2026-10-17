export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  subagent_concurrency: PositiveInt.pipe(optional).annotate({
    description: "Maximum number of subagents that may execute concurrently. Unset allows unlimited concurrency.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
