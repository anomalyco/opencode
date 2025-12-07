import { Bus } from "../bus"
import z from "zod"

export namespace SessionMode {
  export const Event = {
    Changed: Bus.event(
      "session.mode.changed",
      z.object({
        sessionID: z.string(),
        agent: z.string(),
        modeId: z.string(),
        previousModeId: z.string().nullable(),
      }),
    ),
  }
}
