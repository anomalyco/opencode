import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Ide } from "@/ide"
import openUrl from "open"
import z from "zod/v4"

export const BrowserOpen = BusEvent.define(
  "browser.open",
  z.object({
    url: z.string(),
    callbackPort: z.number().optional(),
  }),
)

export namespace Browser {
  export async function open(url: string, options?: { callbackPort?: number }) {
    Bus.publish(BrowserOpen, {
      url,
      callbackPort: options?.callbackPort,
    })
    if (Ide.alreadyInstalled()) return
    return openUrl(url)
  }
}
