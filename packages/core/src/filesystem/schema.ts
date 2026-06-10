import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, RelativePath } from "../schema"

export class Entry extends Schema.Class<Entry>("FileSystem.Entry")({
  path: RelativePath,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
}) {}

export const Submatch = Schema.Struct({
  text: Schema.String,
  start: NonNegativeInt,
  end: NonNegativeInt,
})
export type Submatch = typeof Submatch.Type

export class Match extends Schema.Class<Match>("FileSystem.Match")({
  entry: Entry,
  line: PositiveInt,
  offset: NonNegativeInt,
  text: Schema.String,
  submatches: Schema.Array(Submatch),
}) {}
