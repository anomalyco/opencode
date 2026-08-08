export * as SkillEvent from "./skill-event"

import { Schema } from "effect"
import { define, inventory } from "./event"

const Updated = define({
  type: "skill.updated",
  schema: {
    name: Schema.optional(Schema.String),
    removed: Schema.optional(Schema.Boolean),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }