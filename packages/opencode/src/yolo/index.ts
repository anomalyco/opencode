import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import z from "zod"

export namespace Yolo {
  const log = Log.create({ service: "yolo" })

  let enabled = Flag.OPENCODE_YOLO

  export const Event = {
    Changed: BusEvent.define(
      "yolo.changed",
      z.object({
        enabled: z.boolean(),
      }),
    ),
  }

  export async function init() {
    const config = await Config.global()
    if (config.yolo === true) {
      enabled = true
      log.warn("YOLO mode enabled via config")
    }
    if (Flag.OPENCODE_YOLO) {
      enabled = true
      log.warn("YOLO mode enabled via OPENCODE_YOLO env var")
    }
    if (enabled) {
      log.warn("YOLO mode is ACTIVE - all permission prompts will be auto-approved")
    }
  }

  export function isEnabled(): boolean {
    return enabled
  }

  export function set(value: boolean) {
    const previous = enabled
    enabled = value
    if (previous !== value) {
      log.warn(`YOLO mode ${value ? "ENABLED" : "DISABLED"}`)
      Bus.publish(Event.Changed, { enabled: value })
    }
  }

  export function toggle(): boolean {
    set(!enabled)
    return enabled
  }
}
