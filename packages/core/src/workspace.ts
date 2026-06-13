export * as WorkspaceV2 from "./workspace"

import { Schema } from "effect"
import { withStatics } from "./schema"
import { Identifier } from "./util/identifier"

export const ID = Schema.String.check(Schema.isStartsWith("wrk")).pipe(
  Schema.brand("WorkspaceV2.ID"),
  withStatics((schema) => ({
    ascending: (id?: string) => {
      if (!id) return schema.make("wrk_" + Identifier.ascending())
      if (!id.startsWith("wrk")) throw new Error(`ID ${id} does not start with wrk`)
      return schema.make(id)
    },
    create: () => schema.make("wrk_" + Identifier.ascending()),
  })),
)
export type ID = typeof ID.Type
