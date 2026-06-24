export * as Catalog from "./catalog"

import { define } from "./event"

export const Event = {
  Updated: define({ type: "catalog.updated", schema: {} }),
}
export const CatalogEvent = Event
