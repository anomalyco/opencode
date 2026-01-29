import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace Voice {
  export const Event = {
    Updated: BusEvent.define(
      "voice.updated",
      z.object({
        available: z.boolean(),
      }),
    ),
  }
}
