import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("Memory.ID"))
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  projectID: Schema.String,
  content: Schema.String,
  source: Schema.Union(Schema.Literal("auto"), Schema.Literal("manual")),
  sessionID: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})
export type Info = typeof Info.Type
