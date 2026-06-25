export * as VcsEvent from "./vcs-event"

import { Schema } from "effect"
import { Event } from "./event"

export const BranchUpdated = Event.define({
  type: "vcs.branch.updated",
  schema: {
    branch: Schema.optional(Schema.String),
  },
})

export const Definitions = Event.inventory(BranchUpdated)
