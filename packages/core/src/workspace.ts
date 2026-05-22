export * as Workspace from "./workspace"

import { Schema } from "effect"
import { withStatics } from "./schema"
import { Identifier } from "./util/identifier"

export const ID = Schema.String.pipe(
  Schema.brand("AccountV2.ID"),
  withStatics((schema) => ({ create: () => schema.make("wrk_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type
