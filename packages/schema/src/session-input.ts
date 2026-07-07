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

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

export interface PromptEntry extends Schema.Schema.Type<typeof PromptEntry> {}
export const PromptEntry = Schema.Struct({
  type: Schema.tag("prompt"),
  ...Admitted.fields,
}).annotate({ identifier: "SessionInput.PromptEntry" })

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({
  type: Schema.tag("compaction"),
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  timeCreated: DateTimeUtcFromMillis,
  handledSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Compaction" })

export const Info = Schema.Union([PromptEntry, Compaction]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "SessionInput.Info" }),
)
export type Info = typeof Info.Type
