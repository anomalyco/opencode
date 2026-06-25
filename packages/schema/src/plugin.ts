export * as Plugin from "./plugin"

import { Schema } from "effect"
import { define, inventory } from "./event"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type
export const PluginID = ID

const Added = define({
  type: "plugin.added",
  schema: { id: ID },
})
export const Event = { Added, Definitions: inventory(Added) }
export const PluginEvent = Event
