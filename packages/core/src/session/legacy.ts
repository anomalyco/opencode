export * as SessionLegacy from "./legacy"

import { Schema } from "effect"
import { withStatics } from "../schema"
import { Identifier } from "../util/identifier"

export const MessageID = Schema.String.check(Schema.isStartsWith("msg")).pipe(
  Schema.brand("MessageID"),
  withStatics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "msg_" + Identifier.ascending()) })),
)
export type MessageID = typeof MessageID.Type

export const PartID = Schema.String.check(Schema.isStartsWith("prt")).pipe(
  Schema.brand("PartID"),
  withStatics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "prt_" + Identifier.ascending()) })),
)
export type PartID = typeof PartID.Type
