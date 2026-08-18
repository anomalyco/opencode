import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Schema, Types } from "effect"

export const SessionTransferData = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(SessionV1.WithParts),
})
export type SessionTransferData = Types.DeepMutable<Schema.Schema.Type<typeof SessionTransferData>>

export const SessionTransferArchive = Schema.Struct({
  version: Schema.Literal(1),
  rootSessionID: Session.Info.fields.id,
  sessions: Schema.NonEmptyArray(SessionTransferData),
})
export type SessionTransferArchive = Types.DeepMutable<Schema.Schema.Type<typeof SessionTransferArchive>>

export const SessionTransferFile = Schema.Union([SessionTransferArchive, SessionTransferData])
export type SessionTransferFile = Types.DeepMutable<Schema.Schema.Type<typeof SessionTransferFile>>
