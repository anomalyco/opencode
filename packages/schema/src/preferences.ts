export * as Preferences from "./preferences.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"

export interface Target extends Schema.Schema.Type<typeof Target> {}
export const Target = Schema.Struct({
  kind: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Registered preference kind, such as skill.activation. Each kind defines its value schema.",
  }),
  id: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Subject of the preference. Use global for a preference without an entity-specific subject.",
  }),
}).annotate({ identifier: "Preferences.Target" })

export const Value = Schema.Json.annotate({ identifier: "Preferences.Value" })
export type Value = typeof Value.Type

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  target: Target,
  value: Value,
}).annotate({ identifier: "Preferences.Entry" })

const Updated = ephemeral({ type: "preferences.updated", schema: { target: Target } })
export const Event = { Updated, Definitions: inventory(Updated) }
