import { App } from "../app/app"
import { Bus } from "../bus"
import { File } from "../file"
import { Session } from "../session"
import { Log } from "../util/log"
import { Config } from "./config"
import path from "path"

export namespace ConfigHooks {
  const log = Log.create({ service: "config.hooks" })

  export function init() {
    log.info("init")
    const app = App.info()

    Bus.subscribe(File.Event.Edited, async (payload) => {
      const cfg = await Config.get()
      const ext = path.extname(payload.properties.file)
      for (const item of cfg.experimental?.hook?.file_edited?.[ext] ?? []) {
        log.info("file_edited", {
          file: payload.properties.file,
          command: item.command,
        })
        Bun.spawn({
          cmd: item.command.map((x) => x.replace("$FILE", payload.properties.file)),
          env: item.environment,
          cwd: app.path.cwd,
          stdout: "ignore",
          stderr: "ignore",
        })
      }
    })

    Bus.subscribe(Session.Event.Idle, async () => {
      const cfg = await Config.get()
      if (cfg.experimental?.hook?.session_completed) {
        for (const item of cfg.experimental.hook.session_completed) {
          log.info("session_completed", {
            command: item.command,
          })
          Bun.spawn({
            cmd: item.command,
            cwd: App.info().path.cwd,
            env: item.environment,
            stdout: "ignore",
            stderr: "ignore",
          })
        }
      }
    })
  }
}
