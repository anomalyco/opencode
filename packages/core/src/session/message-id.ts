export * as SessionMessageID from "./message-id"

import { Schema } from "effect"
import { withStatics } from "../schema"
import { Identifier } from "../util/identifier"

export const ID = Schema.String.check(Schema.isStartsWith("msg_")).pipe(
  Schema.brand("Session.Message.ID"),
  withStatics((schema) => ({
    create: () => schema.make("msg_" + Identifier.ascending()),
  })),
)
export type ID = typeof ID.Type
