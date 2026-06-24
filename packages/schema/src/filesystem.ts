export * as FileSystem from "./filesystem"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  path: RelativePath,
  type: Schema.Literals(["file", "directory"]),
}).annotate({ identifier: "FileSystem.Entry" })

export interface Submatch extends Schema.Schema.Type<typeof Submatch> {}
export const Submatch = Schema.Struct({
  text: Schema.String,
  start: NonNegativeInt,
  end: NonNegativeInt,
})

export interface Match extends Schema.Schema.Type<typeof Match> {}
export const Match = Schema.Struct({
  entry: Entry,
  line: PositiveInt,
  offset: NonNegativeInt,
  text: Schema.String,
  submatches: Schema.Array(Submatch),
}).annotate({ identifier: "FileSystem.Match" })
