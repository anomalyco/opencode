export * as Workspace from "./workspace"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { withStatics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("wrk")).pipe(
  Schema.brand("WorkspaceV2.ID"),
  withStatics((schema) => ({
    ascending: (id?: string) => {
      if (!id) return schema.make("wrk_" + ascending())
      if (!id.startsWith("wrk")) throw new Error(`ID ${id} does not start with wrk`)
      return schema.make(id)
    },
    create: () => schema.make("wrk_" + ascending()),
  })),
)
export type ID = typeof ID.Type
