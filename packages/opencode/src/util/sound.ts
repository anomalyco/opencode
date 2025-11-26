import { spawn } from "child_process"
import { Config } from "../config/config"
import { Log } from "./log"

export namespace Sound {
  const log = Log.create({ service: "sound" })

  export async function playNotification() {
    const config = await Config.get()
    const setting = config.notificationSound

    if (!setting) return

    if (setting === true) {
      // Use system bell
      process.stdout.write("\x07")
      return
    }

    if (typeof setting === "string") {
      // Execute custom command
      try {
        const [command, ...args] = setting.split(" ")
        const proc = spawn(command, args, {
          detached: true,
          stdio: "ignore",
        })
        proc.unref()
      } catch (error) {
        log.error("failed to play notification sound", { error, command: setting })
      }
    }
  }
}
