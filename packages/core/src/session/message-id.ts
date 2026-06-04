export * as SessionMessageID from "./message-id"

import { Schema } from "effect"
import { EventV2 } from "../event"
import { withStatics } from "../schema"
import { Identifier } from "../util/identifier"

export const ID = Schema.String.check(Schema.isStartsWith("msg_")).pipe(
  Schema.brand("Session.Message.ID"),
  withStatics((schema) => ({
    create: () => schema.make("msg_" + Identifier.ascending()),
    fromEvent: (id: EventV2.ID) => schema.make("msg" + id.slice(3)),
    toEvent: (id: ID) => EventV2.ID.make("evt" + id.slice(3)),
  })),
)
export type ID = typeof ID.Type
