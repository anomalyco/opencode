export * as LocationFileSystem from "./location-filesystem"

import { Context, Effect, Schema } from "effect"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export class Content extends Schema.Class<Content>("LocationFileSystem.Content")({
  type: Schema.Literals(["text", "binary"]),
  content: Schema.String,
  encoding: Schema.Literal("base64").pipe(Schema.optional),
  mime: Schema.String.pipe(Schema.optional),
}) {}

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export class Entry extends Schema.Class<Entry>("LocationFileSystem.Entry")({
  path: RelativePath,
  uri: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
}) {}

export const FindInput = Schema.Struct({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type FindInput = typeof FindInput.Type

export const GrepInput = Schema.Struct({
  pattern: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type GrepInput = typeof GrepInput.Type

export class GrepMatch extends Schema.Class<GrepMatch>("LocationFileSystem.GrepMatch")({
  path: RelativePath,
  lines: Schema.String,
  line: PositiveInt,
  offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
}) {}

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<Content>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<GrepMatch[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LocationFileSystem") {}
