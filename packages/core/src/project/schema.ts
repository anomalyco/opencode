export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { AbsolutePath, withStatics } from "../schema"

export const ID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  withStatics((schema) => ({
    global: schema.make("global"),
  })),
)
export type ID = typeof ID.Type

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
