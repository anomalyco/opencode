export * as ConfigResourceEvent from "./config-resource-event"

import { Schema } from "effect"
import { define, inventory } from "./event"

const Updated = define({
  type: "config.resources.updated",
  schema: {
    revision: Schema.Int,
    status: Schema.Literals(["ready", "error"]),
    error: Schema.optional(Schema.String),
    restartRequired: Schema.Array(Schema.String),
  },
})

export const Event = { Updated, Definitions: inventory(Updated) }
