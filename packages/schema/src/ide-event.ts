export * as IdeEvent from "./ide-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"

export const Installed = Event.ephemeral({
  type: "ide.installed",
  schema: {
    ide: Schema.String,
  },
})

export const Definitions = Event.inventory(Installed)
