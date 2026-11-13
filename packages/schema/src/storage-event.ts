export * as StorageEvent from "./storage-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"

/** Saving to storage started failing. Ephemeral, so it reaches clients even though nothing can be saved. */
export const Failed = Event.ephemeral({
  type: "storage.failed",
  schema: {
    message: Schema.String,
  },
})

export const Definitions = Event.inventory(Failed)
