import { z } from "zod"
import { Bus } from "../bus"

export namespace File {
  export const Event = {
    Edited: Bus.event(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }
}
