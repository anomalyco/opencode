export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  subagent_depth: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
}) {}
