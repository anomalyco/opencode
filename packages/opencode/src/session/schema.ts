import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { SessionV2 } from "@opencode-ai/core/session"
import { statics } from "@opencode-ai/core/schema"

export const SessionID = SessionV2.ID
export type SessionID = Schema.Schema.Type<typeof SessionID>

export const MessageID = Schema.String.check(Schema.isStartsWith("msg")).pipe(
  Schema.brand("MessageID"),
  statics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("message", id)),
  })),
)

export type MessageID = Schema.Schema.Type<typeof MessageID>

export const PartID = Schema.String.check(Schema.isStartsWith("prt")).pipe(
  Schema.brand("PartID"),
  statics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("part", id)),
  })),
)

export type PartID = Schema.Schema.Type<typeof PartID>
