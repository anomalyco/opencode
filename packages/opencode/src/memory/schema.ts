import { Schema } from "effect"

import { withStatics } from "@/util/schema"

export const MemoryID = Schema.String.pipe(
  Schema.brand("MemoryID"),
  withStatics((s) => ({ make: (id: string) => s.makeUnsafe(id) })),
)
export type MemoryID = Schema.Schema.Type<typeof MemoryID>

export const RuleID = Schema.String.pipe(
  Schema.brand("RuleID"),
  withStatics((s) => ({ make: (id: string) => s.makeUnsafe(id) })),
)
export type RuleID = Schema.Schema.Type<typeof RuleID>

export const APIKeyID = Schema.String.pipe(
  Schema.brand("APIKeyID"),
  withStatics((s) => ({ make: (id: string) => s.makeUnsafe(id) })),
)
export type APIKeyID = Schema.Schema.Type<typeof APIKeyID>

export type PreferenceType = "string" | "number" | "boolean" | "json"

const PreferenceTypeSchema = Schema.Union([
  Schema.Literal("string"),
  Schema.Literal("number"),
  Schema.Literal("boolean"),
  Schema.Literal("json"),
])

export class Preference extends Schema.Class<Preference>("Preference")({
  id: MemoryID,
  key: Schema.String,
  value: Schema.Unknown,
  type: PreferenceTypeSchema,
  description: Schema.NullOr(Schema.String),
  time_created: Schema.Number,
  time_updated: Schema.Number,
}) {}

export class Rule extends Schema.Class<Rule>("Rule")({
  id: RuleID,
  project_id: Schema.String,
  pattern: Schema.String,
  rule: Schema.String,
  priority: Schema.Number,
  enabled: Schema.Boolean,
  time_created: Schema.Number,
  time_updated: Schema.Number,
}) {}

export class APIKey extends Schema.Class<APIKey>("APIKey")({
  id: APIKeyID,
  provider: Schema.String,
  key_name: Schema.String,
  description: Schema.NullOr(Schema.String),
  time_created: Schema.Number,
  time_updated: Schema.Number,
}) {}

export class MemoryRepoError extends Schema.TaggedErrorClass<MemoryRepoError>()("MemoryRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class MemoryServiceError extends Schema.TaggedErrorClass<MemoryServiceError>()("MemoryServiceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export type MemoryError = MemoryRepoError | MemoryServiceError
