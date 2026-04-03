import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import z from "zod"

export const SessionErrorEvent = BusEvent.define(
  "session.error",
  z.object({
    sessionID: SessionID.zod.optional(),
    error: MessageV2.Assistant.shape.error,
  }),
)
