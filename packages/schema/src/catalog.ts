export * as Catalog from "./catalog.js"

import { ephemeral, inventory } from "./event.js"

const Updated = ephemeral({ type: "catalog.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }
