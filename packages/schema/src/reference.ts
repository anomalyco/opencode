export * as Reference from "./reference.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ephemeral, inventory } from "./event.js"
import { AbsolutePath } from "./schema.js"

const Updated = ephemeral({ type: "reference.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export interface LocalSource extends Schema.Schema.Type<typeof LocalSource> {}
export const LocalSource = Schema.Struct({
  type: Schema.Literal("local"),
  path: AbsolutePath,
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Reference.LocalSource" })

export interface GitSource extends Schema.Schema.Type<typeof GitSource> {}
export const GitSource = Schema.Struct({
  type: Schema.Literal("git"),
  repository: Schema.String,
  branch: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Reference.GitSource" })

export const Source = Schema.Union([LocalSource, GitSource])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Reference.Source" })
export type Source = typeof Source.Type

export const Info = Schema.Struct({
  name: Schema.String,
  path: AbsolutePath,
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
  source: Source,
}).annotate({ identifier: "Reference.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
