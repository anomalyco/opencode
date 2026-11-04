export * as VcsEvent from "./vcs-event.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Event } from "./event.js"

export const BranchUpdated = Event.ephemeral({
  type: "vcs.branch.updated",
  schema: {
    branch: optional(Schema.String),
  },
})

export const Definitions = Event.inventory(BranchUpdated)
