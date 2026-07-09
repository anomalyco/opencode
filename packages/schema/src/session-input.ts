export * as SessionInput from "./session-input.js"

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
}).annotate({ identifier: "SessionInput.UserData" })

export interface SyntheticData extends Schema.Schema.Type<typeof SyntheticData> {}
export const SyntheticData = Schema.Struct({
  text: Schema.String,
  description: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "SessionInput.SyntheticData" })

export interface UserMessage extends Schema.Schema.Type<typeof UserMessage> {}
export const UserMessage = Schema.Struct({
  type: Schema.tag("user"),
  data: UserData,
  delivery: Delivery,
}).annotate({ identifier: "SessionInput.UserMessage" })

export interface SyntheticMessage extends Schema.Schema.Type<typeof SyntheticMessage> {}
export const SyntheticMessage = Schema.Struct({
  type: Schema.tag("synthetic"),
  data: SyntheticData,
  delivery: Delivery,
}).annotate({ identifier: "SessionInput.SyntheticMessage" })

export const Message = Schema.Union([UserMessage, SyntheticMessage]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "SessionInput.Message" }),
)
export type Message = typeof Message.Type

const Admitted = {
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  timeCreated: DateTimeUtcFromMillis,
}
const MessageLifecycle = {
  ...Admitted,
  promotedSeq: NonNegativeInt.pipe(optional),
}

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  ...MessageLifecycle,
  ...UserMessage.fields,
}).annotate({ identifier: "SessionInput.User" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({
  ...MessageLifecycle,
  ...SyntheticMessage.fields,
}).annotate({ identifier: "SessionInput.Synthetic" })

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({
  ...Admitted,
  type: Schema.tag("compaction"),
  handledSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Compaction" })

export const Info = Schema.Union([User, Synthetic, Compaction]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "SessionInput.Info" }),
)
export type Info = typeof Info.Type
