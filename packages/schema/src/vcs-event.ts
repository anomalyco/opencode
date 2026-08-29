export * as VcsEvent from "./vcs-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"

export const BranchUpdated = Event.define({
  type: "vcs.branch.updated",
  schema: {
    branch: optional(Schema.String),
    dirty: optional(Schema.Boolean),
    has_conflicts: optional(Schema.Boolean),
  },
})

export const Definitions = Event.inventory(BranchUpdated)
