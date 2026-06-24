export * as Plugin from "./plugin"

import { Schema } from "effect"
import { define } from "./event"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type
export const PluginID = ID

export const Event = {
  Added: define({
    type: "plugin.added",
    schema: { id: ID },
  }),
}
export const PluginEvent = Event
