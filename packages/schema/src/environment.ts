export * as Environment from "./environment.js"

import { Schema } from "effect"
import { AbsolutePath } from "./schema.js"

/** An environment's name: what a path will later use to say where it lives. */
export const ID = Schema.String.pipe(Schema.brand("Environment.ID"), Schema.annotate({ identifier: "Environment.ID" }))
export type ID = typeof ID.Type

/** The server's own machine. */
export const localID = ID.make("local")

/** Where a file or a directory is: an absolute path in an environment. */
export interface Place extends Schema.Schema.Type<typeof Place> {}
export const Place = Schema.Struct({
  absolute: AbsolutePath,
  environment: Schema.Struct({ id: ID }),
}).annotate({ identifier: "Environment.Place" })
