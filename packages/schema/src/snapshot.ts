export * as Snapshot from "./snapshot.js"

import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("Snapshot.ID"))
export type ID = typeof ID.Type
