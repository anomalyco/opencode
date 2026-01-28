import z from "zod"
import { BusEvent } from "../bus/bus-event"

export namespace Browser {
  export const OpenRequested = BusEvent.define(
    "browser.open.requested",
    z.object({
      url: z.string(),
      sessionID: z.string(),
      messageID: z.string(),
    }),
  )
}
