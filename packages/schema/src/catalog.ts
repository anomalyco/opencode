export * as Catalog from "./catalog.js"

import { define, inventory } from "./event.js"

const Updated = define({ type: "catalog.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }
