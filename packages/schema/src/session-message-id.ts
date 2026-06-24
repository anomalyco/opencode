export * as SessionMessageID from "./session-message-id"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { withStatics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("msg_")).pipe(
  Schema.brand("Session.Message.ID"),
  withStatics((schema) => ({ create: () => schema.make("msg_" + ascending()) })),
)
export type ID = typeof ID.Type
