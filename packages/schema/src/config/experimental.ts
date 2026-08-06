export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  subagent_depth: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, Schema.optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
