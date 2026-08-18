export * as WorktreeEvent from "./worktree-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"

export const Ready = Event.define({
  type: "worktree.ready",
  schema: {
    name: Schema.String,
    branch: optional(Schema.String),
  },
})

export const Failed = Event.define({
  type: "worktree.failed",
  schema: {
    message: Schema.String,
  },
})

export const Definitions = Event.inventory(Ready, Failed)
