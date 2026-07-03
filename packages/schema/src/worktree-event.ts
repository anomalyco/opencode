export * as WorktreeEvent from "./worktree-event.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Event } from "./event.js"

export const Ready = Event.ephemeral({
  type: "worktree.ready",
  schema: {
    name: Schema.String,
    branch: optional(Schema.String),
  },
})

export const Failed = Event.ephemeral({
  type: "worktree.failed",
  schema: {
    message: Schema.String,
  },
})

export const Definitions = Event.inventory(Ready, Failed)
