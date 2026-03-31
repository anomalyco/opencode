import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
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

  async function readGlobalYolo(): Promise<boolean> {
    const filepath = path.join(Global.Path.config, "config.json")
    try {
      const text = await Bun.file(filepath).text()
      const parsed = JSON.parse(text)
      return parsed?.yolo === true
    } catch {
      return false
    }
  }

  export async function init() {
    if (await readGlobalYolo()) {
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
      void Bus.publish(Event.Changed, { enabled: value }).catch((err) => {
        log.debug("failed to publish yolo.changed", { err: String(err) })
      })
    }
  }

  export function toggle(): boolean {
    set(!enabled)
    return enabled
  }
}
