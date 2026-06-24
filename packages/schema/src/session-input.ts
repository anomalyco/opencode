export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { Session } from "./session"
import { SessionMessage } from "./session-message"

export const Delivery = Schema.Literals(["steer", "queue"])
export type Delivery = typeof Delivery.Type

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: Session.ID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(Schema.optional),
}).annotate({ identifier: "SessionInput.Admitted" })
