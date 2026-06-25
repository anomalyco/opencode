import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

export const SessionID = Schema.String.check(Schema.isStartsWith("ses")).pipe(
  Schema.brand("SessionID"),
  withStatics((schema) => {
    const create = () => schema.make("ses_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type SessionID = typeof SessionID.Type
