export * as Plugin from "./plugin.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
}).annotate({ identifier: "Plugin.Info" })

const Added = ephemeral({
  type: "plugin.added",
  schema: { id: ID },
})
const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Added, Updated, Definitions: inventory(Added, Updated) }
