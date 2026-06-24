export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessageID } from "./session-message-id"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessageID.ID,
  sessionID: SessionID.ID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(Schema.optional),
}).annotate({ identifier: "SessionInput.Admitted" })
