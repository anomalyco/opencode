export * as InstallationEvent from "./installation-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"

export const Updated = Event.ephemeral({
  type: "installation.updated",
  schema: {
    version: Schema.String,
  },
})

export const UpdateAvailable = Event.ephemeral({
  type: "installation.update-available",
  schema: {
    version: Schema.String,
  },
})

export const Definitions = Event.inventory(Updated, UpdateAvailable)
