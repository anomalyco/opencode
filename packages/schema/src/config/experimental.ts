export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }).pipe(optional),
  subagent_depth: NonNegativeInt.annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }).pipe(optional),
  policies: ConfigPolicy.Info.pipe(Schema.Array)
    .annotate({
      description: "Ordered policies controlling access to configured resources",
    })
    .pipe(optional),
}) {}
