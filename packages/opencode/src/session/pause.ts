import z from "zod"

export namespace SessionPause {
  export const Reason = z.enum(["browser_takeover"]).meta({
    ref: "SessionPauseReason",
  })
  export type Reason = z.infer<typeof Reason>

  export const Event = z.enum(["suspended", "resumed"]).meta({
    ref: "SessionPauseEvent",
  })
  export type Event = z.infer<typeof Event>

  export function text(input: { reason: Reason; note?: string }) {
    const note = input.note?.trim()
    if (note) return note
    if (input.reason === "browser_takeover") {
      return "The session was resumed after browser takeover. The user may have changed browser state. Re-check browser state before continuing."
    }
    return "The session was resumed. Re-check current state before continuing."
  }
}
