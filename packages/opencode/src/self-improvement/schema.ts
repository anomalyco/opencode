import { Schema } from "effect"

export const MemoryID = Schema.String.pipe(Schema.brand("MemoryID"))
export type MemoryID = Schema.Schema.Type<typeof MemoryID>

export const MemoryType = Schema.Literals(["episodic", "semantic", "procedural", "pattern"])
export type MemoryType = Schema.Schema.Type<typeof MemoryType>

export const MemoryLayer = Schema.Literals(["short_term", "long_term", "semantic", "procedural"])
export type MemoryLayer = Schema.Schema.Type<typeof MemoryLayer>

export class MemoryInfo extends Schema.Class<MemoryInfo>("MemoryInfo")({
  id: MemoryID,
  session_id: Schema.String,
  workspace_id: Schema.optional(Schema.String),
  type: MemoryType,
  layer: MemoryLayer,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,
  confidence: Schema.Number,
  access_count: Schema.Int,
  version: Schema.Int,
  time_created: Schema.Int,
  time_last_accessed: Schema.Int,
  time_last_evolved: Schema.optional(Schema.Int),
  heartbeat_at: Schema.optional(Schema.Int),
}) {}

export class MemoryRelation extends Schema.Class<MemoryRelation>("MemoryRelation")({
  target_id: MemoryID,
  relation: Schema.String,
  weight: Schema.Number,
}) {}
