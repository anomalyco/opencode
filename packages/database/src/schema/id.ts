import { Schema } from "effect"

export const EntityID = Schema.String.pipe(Schema.brand("EntityID"))
export type EntityID = Schema.Schema.Type<typeof EntityID>

export const RelationID = Schema.String.pipe(Schema.brand("RelationID"))
export type RelationID = Schema.Schema.Type<typeof RelationID>
