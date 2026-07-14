export * as SessionPending from "./session-pending.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Prompt } from "./prompt.js"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema.js"
import { SessionDelivery } from "./session-delivery.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface UserData extends Schema.Schema.Type<typeof UserData> {}
export const UserData = Schema.Struct({
  ...Prompt.fields,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "SessionPending.UserData" })

export interface SyntheticData extends Schema.Schema.Type<typeof SyntheticData> {}
export const SyntheticData = Schema.Struct({
  text: Schema.String,
  description: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "SessionPending.SyntheticData" })

export interface UserMessage extends Schema.Schema.Type<typeof UserMessage> {}
export const UserMessage = Schema.Struct({
  type: Schema.tag("user"),
  data: UserData,
  delivery: Delivery,
}).annotate({ identifier: "SessionPending.UserMessage" })

export interface SyntheticMessage extends Schema.Schema.Type<typeof SyntheticMessage> {}
export const SyntheticMessage = Schema.Struct({
  type: Schema.tag("synthetic"),
  data: SyntheticData,
  delivery: Delivery,
}).annotate({ identifier: "SessionPending.SyntheticMessage" })

export const Message = Schema.Union([UserMessage, SyntheticMessage]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "SessionPending.Message" }),
)
export type Message = typeof Message.Type

const Admitted = {
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  timeCreated: DateTimeUtcFromMillis,
}

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  ...Admitted,
  ...UserMessage.fields,
}).annotate({ identifier: "SessionPending.User" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({
  ...Admitted,
  ...SyntheticMessage.fields,
}).annotate({ identifier: "SessionPending.Synthetic" })

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({
  ...Admitted,
  type: Schema.tag("compaction"),
}).annotate({ identifier: "SessionPending.Compaction" })

export const Info = Schema.Union([User, Synthetic, Compaction]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "SessionPending.Info" }),
)
export type Info = typeof Info.Type
