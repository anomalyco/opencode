import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace Voice {
  export const Status = z
    .discriminatedUnion("status", [
      z.object({
        status: z.literal("disabled"),
      }),
      z.object({
        status: z.literal("idle"),
      }),
      z.object({
        status: z.literal("downloading"),
        progress: z.number(),
      }),
      z.object({
        status: z.literal("loading"),
      }),
      z.object({
        status: z.literal("ready"),
        model: z.string(),
      }),
      z.object({
        status: z.literal("error"),
        error: z.string(),
      }),
    ])
    .meta({ ref: "VoiceStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define(
      "voice.updated",
      z.object({
        status: Status,
      }),
    ),
  }
}
