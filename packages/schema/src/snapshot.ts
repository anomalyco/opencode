export * as Snapshot from "./snapshot.js"

import { brand } from "./brand.js"
import { Schema } from "effect"

export const ID = Schema.String.pipe(brand("Snapshot.ID"))
export type ID = typeof ID.Type
