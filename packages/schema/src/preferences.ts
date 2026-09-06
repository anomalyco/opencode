export * as Preferences from "./preferences.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Skill } from "./skill.js"

// Add target variants as domains adopt activation preferences. Each domain owns its identity.
export interface Target extends Schema.Schema.Type<typeof Target> {}
export const Target = Schema.Struct({
  kind: Schema.Literal("skill"),
  id: Skill.ID,
}).annotate({ identifier: "Preferences.Target" })

export const State = Schema.Literals(["enabled", "disabled"]).annotate({ identifier: "Preferences.State" })
export type State = typeof State.Type

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  target: Target,
  state: State,
}).annotate({ identifier: "Preferences.Entry" })

const Updated = ephemeral({ type: "preferences.updated", schema: { target: Target } })
export const Event = { Updated, Definitions: inventory(Updated) }
