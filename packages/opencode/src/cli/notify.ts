import * as Process from "@/util/process"
import { Flag } from "@opencode-ai/core/flag/flag"

const noop = () => {}

export const notify = Flag.OPENCODE_DISABLE_NOTIFICATIONS
  ? noop
  : (title: string, message?: string) => {
      const { platform } = process
      if (platform === "linux") {
        Process.spawn(["notify-send", title, message ?? ""])
      } else if (platform === "darwin") {
        const msg = (message ?? "").replace(/"/g, '\\"')
        Process.spawn(["osascript", "-e", `display notification "${msg}" with title "${title}"`])
      }
    }

export const notifyError = notify

export * as Notify from "./notify"
