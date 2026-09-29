export * as Widget from "./widget.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("Widget.ID"))
export type ID = typeof ID.Type

// A widget is a user-authored HTML/JS/CSS bundle discovered on disk. The source
// records where it came from so the UI can explain how to edit or remove it.
export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("global"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("project"), path: Schema.String }),
]).annotate({ identifier: "Widget.Source" })
export type Source = typeof Source.Type

// A widget that fails to load stays in the inventory with a reason so the UI can
// surface it instead of silently hiding the folder.
export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("active") }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
]).annotate({ identifier: "Widget.State" })
export type State = typeof State.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  description: optional(Schema.String),
  source: Source,
  state: State,
}).annotate({ identifier: "Widget.Info" })

// Emitted when the widgets directory changes so clients can refresh the list
// without restarting the server.
const Updated = ephemeral({ type: "widget.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }
